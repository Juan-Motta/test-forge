"""Adapter for a simple JSON voice relay: base64 PCM16 audio both ways, one session per call.

Unlike the Vivi protocols, the server sends no identifying frame, so this protocol is always
chosen on the agent, never detected. Contract:
- optionally, the session is created first: `POST <session URL>` with `{}` answers
  `{"session_id": "..."}`; without a session URL the run's thread id is the session id;
- the socket is `<base URL>?session_id=<id>`;
- client → server: `{"type": "audio", "audio": <b64>}` and `{"type": "stop"}` (ends the call);
- server → client: `ready`, `audio`, `user_transcript` / `user_done` (the caller's speech),
  `agent_transcript` (`delta`) / `agent_done` (`text`, the whole answer), `interrupted` (the
  server cut its own answer when the caller spoke over it), `turn`, `error` and `closed`;
- the agent never speaks first and the server detects the caller's turns itself (VAD): there
  is no response start or end to rely on, so agent turns end on silence.
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlencode

import httpx

from voice_eval.audio import b64decode
from voice_eval.ports.target import (
    AudioDelta,
    Closed,
    NotSupportedError,
    Ready,
    ServerError,
    ServerEvent,
    TranscriptMessage,
    TranscriptUpdate,
    UnknownEvent,
)
from voice_eval.targets.connection import WebSocketTarget, encode_audio
from voice_eval.targets.vivi_live import TranscriptStore

log = logging.getLogger(__name__)

SESSION_TIMEOUT_S = 10.0
MAX_SESSION_ID_CHARS = 200


class SessionCreateError(ConnectionError):
    """The session URL did not give a session id: a run reports it as a failed connection."""


def relay_url(base_url: str, session_id: str) -> str:
    return f"{base_url.rstrip('/')}?{urlencode({'session_id': session_id})}"


async def create_session(
    session_url: str,
    origin: str | None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    """`POST session_url` with `{}` and return its `session_id`. Raises `SessionCreateError`."""
    headers = {"origin": origin} if origin else {}
    try:
        async with httpx.AsyncClient(transport=transport, timeout=SESSION_TIMEOUT_S) as client:
            response = await client.post(session_url, json={}, headers=headers)
    except httpx.HTTPError as exc:
        raise SessionCreateError(
            f"the session URL could not be reached ({type(exc).__name__})"
        ) from None
    if response.status_code >= 400:
        raise SessionCreateError(f"the session URL answered {response.status_code}")
    try:
        session_id = response.json().get("session_id")
    except (ValueError, AttributeError):
        session_id = None
    if not isinstance(session_id, str) or not 0 < len(session_id) <= MAX_SESSION_ID_CHARS:
        raise SessionCreateError('the session URL answered without a "session_id"')
    return session_id


class RelayClient(WebSocketTarget):
    protocol = "relay"
    agent_speaks_first = False
    explicit_turn_end = False
    supports_text = False
    supports_playback_interruption = False

    def __init__(
        self,
        base_url: str,
        channel_id: str,
        user_id: str,
        thread_id: str | None = None,
        origin: str | None = None,
    ) -> None:
        super().__init__(base_url, channel_id, user_id, thread_id, origin)
        self.transcript = TranscriptStore()
        # Each finished utterance closes a message; the next delta starts a new one.
        self._turns = {"user": 0, "assistant": 0}
        self._text = {"user": "", "assistant": ""}

    @property
    def url(self) -> str:
        return relay_url(self.base_url, self.thread_id)

    def _caption(
        self, role: str, text: str, raw: dict[str, Any], *, done: bool
    ) -> TranscriptUpdate:
        event = TranscriptUpdate(
            role=role,
            message_id=f"{role}-{self._turns[role]}",
            text=text,
            start_ms=None,
            end_ms=None,
            raw=raw,
        )
        self.transcript.update(event)
        if done:
            self._turns[role] += 1
            self._text[role] = ""
        else:
            self._text[role] = text
        return event

    def parse(self, raw: dict[str, Any]) -> ServerEvent:
        kind = raw.get("type")
        match kind:
            case "ready":
                return Ready(session_id=self.thread_id, raw=raw)
            case "audio":
                return AudioDelta(pcm=b64decode(raw.get("audio", "")), raw=raw)
            case "agent_transcript" | "user_transcript":
                role = "assistant" if kind == "agent_transcript" else "user"
                text = self._text[role] + str(raw.get("delta", ""))
                return self._caption(role, text, raw, done=False)
            case "agent_done" | "user_done":
                role = "assistant" if kind == "agent_done" else "user"
                text = str(raw.get("text", "")) or self._text[role]
                return self._caption(role, text, raw, done=True)
            case "error":
                return ServerError(message=str(raw.get("message", "")), raw=raw)
            case "closed":
                return Closed(usage_seconds=None, final_usage_confirmed=False, raw=raw)
            case other:
                return UnknownEvent(type=str(other), raw=raw)

    async def events(self) -> AsyncIterator[ServerEvent]:
        """Yield parsed server events until the socket closes."""
        async for raw in self._frames():
            try:
                event = self.parse(raw)
            except (TypeError, ValueError) as exc:
                log.warning("malformed %r event kept as unknown: %s", raw.get("type"), exc)
                event = UnknownEvent(type=str(raw.get("type")), raw=raw)
            if isinstance(event, Ready):
                self.session_id = event.session_id
            yield event

    async def send_caller_audio(self, pcm: bytes) -> None:
        await self._require_ws().send(json.dumps({"type": "audio", "audio": encode_audio(pcm)}))

    async def send_caller_text(self, text: str) -> None:
        raise NotSupportedError("the relay protocol only accepts caller audio (no text turns)")

    async def request_agent_turn(self) -> None:
        raise NotSupportedError("the relay protocol has no way to request an agent turn")

    async def send_playback_interrupted(
        self, item_id: str, response_id: str, audio_end_ms: int | None
    ) -> None:
        raise NotSupportedError("the relay protocol has no client playback interruption")

    async def close(self) -> dict[str, Any]:
        """Ask the server to end the call; it answers with `closed` and closes the socket."""
        record = {"type": "stop"}
        await self._require_ws().send(json.dumps(record))
        return record

    def transcript_messages(self) -> list[TranscriptMessage]:
        return self.transcript.messages()
