"""Adapter for the Vivi Live realtime WebSocket (`voiceCapability=live-v1`).

Wire contract: JSON text frames only, PCM16 mono 24 kHz base64 audio. The server rejects
(closes the session on) any client message other than `voice.input.audio` and `voice.close`.
"""

import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlencode

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed

from voice_eval.audio import MAX_B64_CHARS, b64decode, b64encode

log = logging.getLogger(__name__)

MAX_FRAME_CHARS = 150_000
MAX_INCOMING_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True, kw_only=True)
class ServerEvent:
    raw: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)


@dataclass(frozen=True, kw_only=True)
class ProtocolInfo(ServerEvent):
    protocol: str


@dataclass(frozen=True, kw_only=True)
class Ready(ServerEvent):
    session_id: str


@dataclass(frozen=True, kw_only=True)
class AudioDelta(ServerEvent):
    pcm: bytes


@dataclass(frozen=True, kw_only=True)
class TranscriptUpdate(ServerEvent):
    role: str
    message_id: str
    text: str
    start_ms: int | None
    end_ms: int | None


@dataclass(frozen=True, kw_only=True)
class TaskStatus(ServerEvent):
    pass


@dataclass(frozen=True, kw_only=True)
class Closed(ServerEvent):
    usage_seconds: float | None
    final_usage_confirmed: bool


@dataclass(frozen=True, kw_only=True)
class UnknownEvent(ServerEvent):
    type: str


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


@dataclass
class TranscriptMessage:
    message_id: str
    role: str
    text: str
    start_ms: int | None
    end_ms: int | None
    order: int


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


class ViviLiveClient:
    def __init__(
        self,
        base_url: str,
        channel_id: str,
        user_id: str,
        thread_id: str | None = None,
        origin: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.channel_id = channel_id
        self.user_id = user_id
        self.thread_id = thread_id or str(uuid.uuid4())
        self.origin = origin
        self.session_id: str | None = None
        self.transcript = TranscriptStore()
        self._ws: ClientConnection | None = None

    @property
    def url(self) -> str:
        query = urlencode(
            {"voiceCapability": "live-v1", "userId": self.user_id, "threadId": self.thread_id}
        )
        return f"{self.base_url}/channelApi/{quote(self.channel_id, safe='')}/realtime?{query}"

    @property
    def close_code(self) -> int | None:
        return self._ws.close_code if self._ws else None

    @property
    def close_reason(self) -> str | None:
        return self._ws.close_reason if self._ws else None

    async def connect(self) -> None:
        self._ws = await connect(self.url, origin=self.origin, max_size=MAX_INCOMING_BYTES)

    async def events(self) -> AsyncIterator[ServerEvent]:
        """Yield parsed server events until the socket closes."""
        ws = self._require_ws()
        try:
            async for message in ws:
                try:
                    raw = json.loads(message)
                except (TypeError, ValueError):
                    log.warning("non-JSON frame ignored (%s)", type(message).__name__)
                    continue
                if not isinstance(raw, dict):
                    log.warning("non-object JSON frame ignored")
                    continue
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
        except ConnectionClosed:
            return

    async def send_audio_frame(self, pcm: bytes) -> None:
        if not pcm or len(pcm) % 2:
            raise ValueError(f"audio frame must be a non-empty even byte count, got {len(pcm)}")
        encoded = b64encode(pcm)
        if len(encoded) > MAX_B64_CHARS:
            raise ValueError(f"audio frame too large: {len(encoded)} base64 chars")
        frame = json.dumps({"type": "voice.input.audio", "audio": encoded})
        if len(frame) > MAX_FRAME_CHARS:
            raise ValueError(f"audio message too large: {len(frame)} chars")
        await self._require_ws().send(frame)

    async def close(self) -> None:
        """Ask the server to end the session gracefully; it answers with `voice.closed`."""
        if self._ws is not None:
            await self._ws.send(json.dumps({"type": "voice.close"}))

    async def disconnect(self) -> None:
        if self._ws is not None:
            await self._ws.close()

    def _require_ws(self) -> ClientConnection:
        if self._ws is None:
            raise RuntimeError("not connected; call connect() first")
        return self._ws
