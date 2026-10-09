"""Adapter for the Vivi Live realtime WebSocket (`voiceCapability=live-v1`, `voice.*` events).

Wire contract: JSON text frames only, PCM16 mono 24 kHz base64 audio. The server rejects
(closes the session on) any client message other than `voice.input.audio` and `voice.close`.
The agent greets first and there is no response-done event: turn ends are inferred from audio.
"""

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from voice_eval.audio import MAX_B64_CHARS, b64decode
from voice_eval.ports.target import (
    AudioDelta,
    Closed,
    NotSupportedError,
    Ready,
    ServerEvent,
    TranscriptMessage,
    TranscriptUpdate,
    UnknownEvent,
)
from voice_eval.targets.connection import WebSocketTarget, encode_audio

__all__ = [
    "AudioDelta",
    "Closed",
    "ProtocolInfo",
    "Ready",
    "ServerEvent",
    "TaskStatus",
    "TranscriptMessage",
    "TranscriptStore",
    "TranscriptUpdate",
    "UnknownEvent",
    "ViviLiveClient",
    "parse_event",
]

log = logging.getLogger(__name__)

MAX_FRAME_CHARS = 150_000


@dataclass(frozen=True, kw_only=True)
class ProtocolInfo(ServerEvent):
    protocol: str


@dataclass(frozen=True, kw_only=True)
class TaskStatus(ServerEvent):
    pass


def parse_event(raw: dict[str, Any]) -> ServerEvent:
    match raw.get("type"):
        case "voice.protocol":
            return ProtocolInfo(protocol=str(raw.get("protocol", "")), raw=raw)
        case "voice.ready":
            return Ready(session_id=str(raw.get("sessionId", "")), raw=raw)
        case "voice.audio.delta":
            return AudioDelta(pcm=b64decode(raw.get("delta", "")), raw=raw)
        case "voice.transcript.update":
            return TranscriptUpdate(
                role=str(raw.get("role", "")),
                message_id=str(raw.get("messageId", "")),
                text=str(raw.get("text", "")),
                start_ms=raw.get("startMs"),
                end_ms=raw.get("endMs"),
                raw=raw,
            )
        case "voice.task.status":
            return TaskStatus(raw=raw)
        case "voice.closed":
            return Closed(
                usage_seconds=raw.get("usageSeconds"),
                final_usage_confirmed=bool(raw.get("finalUsageConfirmed", False)),
                raw=raw,
            )
        case other:
            return UnknownEvent(type=str(other), raw=raw)


class TranscriptStore:
    """Captions are cumulative per message group: each update replaces the previous text."""

    def __init__(self) -> None:
        self._messages: dict[str, TranscriptMessage] = {}

    def update(self, event: TranscriptUpdate) -> bool:
        current = self._messages.get(event.message_id)
        if current is None:
            self._messages[event.message_id] = TranscriptMessage(
                event.message_id,
                event.role,
                event.text,
                event.start_ms,
                event.end_ms,
                order=len(self._messages),
            )
            return True
        changed = current.text != event.text
        current.text = event.text
        current.role = event.role or current.role
        current.start_ms = event.start_ms if event.start_ms is not None else current.start_ms
        current.end_ms = event.end_ms if event.end_ms is not None else current.end_ms
        return changed

    def messages(self) -> list[TranscriptMessage]:
        def key(m: TranscriptMessage) -> tuple[float, int]:
            return (m.start_ms if m.start_ms is not None else float("inf"), m.order)

        return sorted(self._messages.values(), key=key)


class ViviLiveClient(WebSocketTarget):
    protocol = "live"
    agent_speaks_first = True
    explicit_turn_end = False
    supports_text = False

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

    async def events(self) -> AsyncIterator[ServerEvent]:
        """Yield parsed server events until the socket closes."""
        async for raw in self._frames():
            try:
                event = parse_event(raw)
            except (TypeError, ValueError) as exc:
                log.warning("malformed %r event kept as unknown: %s", raw.get("type"), exc)
                event = UnknownEvent(type=str(raw.get("type")), raw=raw)
            if isinstance(event, Ready):
                self.session_id = event.session_id
            elif isinstance(event, TranscriptUpdate):
                self.transcript.update(event)
            elif isinstance(event, UnknownEvent):
                log.info("unknown server event type %r kept", event.type)
            yield event

    async def send_caller_audio(self, pcm: bytes) -> None:
        encoded = encode_audio(pcm)
        if len(encoded) > MAX_B64_CHARS:
            raise ValueError(f"audio frame too large: {len(encoded)} base64 chars")
        frame = json.dumps({"type": "voice.input.audio", "audio": encoded})
        if len(frame) > MAX_FRAME_CHARS:
            raise ValueError(f"audio message too large: {len(frame)} chars")
        await self._require_ws().send(frame)

    async def send_caller_text(self, text: str) -> None:
        raise NotSupportedError("the Live protocol only accepts caller audio (no text turns)")

    async def request_agent_turn(self) -> None:
        raise NotSupportedError("the Live protocol has no way to request an agent turn")

    async def close(self) -> dict[str, Any]:
        """Ask the server to end the session gracefully; it answers with `voice.closed`."""
        record = {"type": "voice.close"}
        await self._require_ws().send(json.dumps(record))
        return record

    def transcript_messages(self) -> list[TranscriptMessage]:
        return self.transcript.messages()
