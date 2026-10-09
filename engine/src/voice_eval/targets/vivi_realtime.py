"""Adapter for the Vivi legacy realtime path, which relays the OpenAI Realtime GA protocol.

Same endpoint URL as Live; the backend picks this path from the agent config. Contract:
- the server closes the socket (1011) on any client event outside `CLIENT_EVENT_TYPES`, so
  `voice.*` events must never be sent here;
- the agent never speaks first; server VAD answers caller audio, `response.create` answers text;
- an agent response runs from `response.created` to `response.done`, and a tool call produces
  several responses in a row, with `response.processing` ticks while the tool runs;
- there is no end-of-session event: the client closes the socket with code 1000.
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from voice_eval.audio import b64decode
from voice_eval.ports.target import (
    AgentBusy,
    AudioDelta,
    Ready,
    ResponseDone,
    ResponseStarted,
    ServerError,
    ServerEvent,
    TranscriptMessage,
    UnknownEvent,
)
from voice_eval.targets.connection import WebSocketTarget, encode_audio

log = logging.getLogger(__name__)

CLIENT_EVENT_TYPES = frozenset(
    {
        "session.update",
        "input_audio_buffer.append",
        "input_audio_buffer.commit",
        "input_audio_buffer.clear",
        "conversation.item.create",
        "conversation.item.delete",
        "conversation.item.truncate",
        "response.create",
        "response.cancel",
    }
)
TOOL_EVENT_PREFIXES = ("response.processing", "response.function_call_arguments.")
TRANSCRIPT_ROLES = ("user", "assistant")


class RealtimeTranscript:
    """User/assistant messages in conversation-item order, text filled in as it arrives."""

    def __init__(self) -> None:
        self._messages: dict[str, TranscriptMessage] = {}
        self._final: set[str] = set()
        self._unmatched_text: list[str] = []  # ids of sent text not yet echoed by the server
        self._sent = 0

    def _get(self, item_id: str, role: str) -> TranscriptMessage:
        message = self._messages.get(item_id)
        if message is None:
            message = TranscriptMessage(item_id, role, "", None, None, order=self._next_order())
            self._messages[item_id] = message
        return message

    def _next_order(self) -> int:
        return max((m.order for m in self._messages.values()), default=-1) + 1

    def record_sent_text(self, text: str) -> None:
        self._sent += 1
        local_id = f"local-text-{self._sent}"
        self._get(local_id, "user").text = text
        self._final.add(local_id)
        self._unmatched_text.append(local_id)

    def on_item(self, item: dict[str, Any]) -> None:
        item_id, role = item.get("id"), item.get("role")
        if item.get("type") != "message" or role not in TRANSCRIPT_ROLES or not item_id:
            return
        if item_id in self._messages:
            return
        text = _input_text(item)
        if role == "user" and text is not None:
            for local_id in self._unmatched_text:
                if self._messages[local_id].text == text:  # server echo of a sent text turn
                    self._unmatched_text.remove(local_id)
                    message = self._messages.pop(local_id)
                    message.message_id = item_id
                    self._messages[item_id] = message
                    self._final.discard(local_id)
                    self._final.add(item_id)
                    return
        message = self._get(item_id, role)
        if text is not None:
            message.text = text
            self._final.add(item_id)

    def append_delta(self, item_id: str, delta: str) -> None:
        if item_id not in self._final:
            self._get(item_id, "assistant").text += delta

    def set_text(self, item_id: str, text: str, role: str) -> None:
        self._get(item_id, role).text = text
        self._final.add(item_id)

    def messages(self) -> list[TranscriptMessage]:
        return sorted(self._messages.values(), key=lambda m: m.order)


def _input_text(item: dict[str, Any]) -> str | None:
    texts = [
        str(part.get("text", ""))
        for part in item.get("content") or []
        if isinstance(part, dict) and part.get("type") == "input_text"
    ]
    return "".join(texts) if texts else None


class ViviRealtimeClient(WebSocketTarget):
    protocol = "realtime"
    agent_speaks_first = False
    explicit_turn_end = True
    supports_text = True

    def __init__(
        self,
        base_url: str,
        channel_id: str,
        user_id: str,
        thread_id: str | None = None,
        origin: str | None = None,
    ) -> None:
        super().__init__(base_url, channel_id, user_id, thread_id, origin)
        self.transcript = RealtimeTranscript()
        self._ready = False

    async def events(self) -> AsyncIterator[ServerEvent]:
        async for raw in self._frames():
            try:
                yield self.normalize(raw)
            except (TypeError, ValueError, AttributeError) as exc:
                log.warning("malformed %r event kept as unknown: %s", raw.get("type"), exc)
                yield UnknownEvent(type=str(raw.get("type")), raw=raw)

    def normalize(self, raw: dict[str, Any]) -> ServerEvent:
        kind = str(raw.get("type", ""))
        item = raw.get("item") if isinstance(raw.get("item"), dict) else {}
        match kind:
            case "session.created":
                session = raw.get("session") or {}
                self.session_id = session.get("id") or self.session_id
                self.model = session.get("model") or self.model
            case "session.updated" if not self._ready:
                # The relay sends this once the session is configured for the agent.
                self._ready = True
                return Ready(session_id=self.session_id or "", raw=raw)
            case "response.created":
                return ResponseStarted(raw=raw)
            case "response.done":
                return ResponseDone(raw=raw)
            case "response.output_audio.delta":
                return AudioDelta(pcm=b64decode(raw.get("delta", "")), raw=raw)
            case "conversation.item.added" | "conversation.item.created":
                self.transcript.on_item(item)
            case "response.output_audio_transcript.delta":
                self.transcript.append_delta(str(raw.get("item_id")), str(raw.get("delta", "")))
            case "response.output_audio_transcript.done":
                transcript = str(raw.get("transcript", ""))
                self.transcript.set_text(str(raw.get("item_id")), transcript, role="assistant")
            case "conversation.item.input_audio_transcription.completed":
                transcript = str(raw.get("transcript", ""))
                self.transcript.set_text(str(raw.get("item_id")), transcript, role="user")
            case "error" | "rate_limit_exhausted":
                return ServerError(message=json.dumps(raw.get("error", raw)), raw=raw)
            case _ if kind.startswith(TOOL_EVENT_PREFIXES):
                return AgentBusy(raw=raw)
            case "response.output_item.added" | "response.output_item.done" if (
                item.get("type") == "function_call"
            ):
                return AgentBusy(raw=raw)
        return UnknownEvent(type=kind, raw=raw)

    async def send_event(self, event: dict[str, Any]) -> None:
        if event.get("type") not in CLIENT_EVENT_TYPES:
            raise ValueError(f"event type {event.get('type')!r} is not allowed on this path")
        await self._require_ws().send(json.dumps(event))

    async def send_caller_audio(self, pcm: bytes) -> None:
        await self.send_event({"type": "input_audio_buffer.append", "audio": encode_audio(pcm)})

    async def send_caller_text(self, text: str) -> None:
        if not text.strip():
            raise ValueError("caller text must not be empty")
        content = [{"type": "input_text", "text": text}]
        item = {"type": "message", "role": "user", "content": content}
        self.transcript.record_sent_text(text)
        await self.send_event({"type": "conversation.item.create", "item": item})
        await self.send_event({"type": "response.create"})

    async def request_agent_turn(self) -> None:
        await self.send_event({"type": "response.create"})

    async def close(self) -> dict[str, Any]:
        """No end-of-session event exists: close the socket normally (1000)."""
        await self._require_ws().close(1000)
        return {"type": "websocket.close", "code": 1000}

    def transcript_messages(self) -> list[TranscriptMessage]:
        return self.transcript.messages()
