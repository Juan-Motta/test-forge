"""WebSocket plumbing shared by the target adapters.

Both Vivi protocols are served by the same endpoint; the backend picks one per agent config.
"""

import json
import logging
import uuid
from collections.abc import AsyncIterator, Iterable
from typing import Any
from urllib.parse import quote, urlencode

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed

from voice_eval.audio import b64encode

log = logging.getLogger(__name__)

MAX_INCOMING_BYTES = 8 * 1024 * 1024
BINARY_FRAME_TYPE = "binary.frame"


def realtime_url(base_url: str, channel_id: str, user_id: str, thread_id: str) -> str:
    query = urlencode({"voiceCapability": "live-v1", "userId": user_id, "threadId": thread_id})
    return f"{base_url.rstrip('/')}/channelApi/{quote(channel_id, safe='')}/realtime?{query}"


async def open_socket(url: str, origin: str | None) -> ClientConnection:
    return await connect(url, origin=origin, max_size=MAX_INCOMING_BYTES)


def decode_frame(message: str | bytes) -> dict[str, Any] | None:
    """JSON object of a text frame; binary frames become a length-only record."""
    if isinstance(message, bytes):
        log.info("binary frame ignored (%d bytes)", len(message))
        return {"type": BINARY_FRAME_TYPE, "bytes": len(message)}
    try:
        raw = json.loads(message)
    except ValueError:
        log.warning("non-JSON frame ignored")
        return None
    if not isinstance(raw, dict):
        log.warning("non-object JSON frame ignored")
        return None
    return raw


def encode_audio(pcm: bytes) -> str:
    if not pcm or len(pcm) % 2:
        raise ValueError(f"audio frame must be a non-empty even byte count, got {len(pcm)}")
    return b64encode(pcm)


class WebSocketTarget:
    """Connection state common to both adapters; subclasses define the wire protocol."""

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
        self.model: str | None = None
        self._ws: ClientConnection | None = None
        self._pending: list[dict[str, Any]] = []

    @property
    def url(self) -> str:
        return realtime_url(self.base_url, self.channel_id, self.user_id, self.thread_id)

    @property
    def close_code(self) -> int | None:
        return self._ws.close_code if self._ws else None

    @property
    def close_reason(self) -> str | None:
        return self._ws.close_reason if self._ws else None

    def attach(self, ws: ClientConnection, pending: Iterable[dict[str, Any]] = ()) -> None:
        """Adopt an open socket; `pending` frames were already read (protocol detection)."""
        self._ws = ws
        self._pending = list(pending)

    async def disconnect(self) -> None:
        if self._ws is not None:
            await self._ws.close()

    async def _frames(self) -> AsyncIterator[dict[str, Any]]:
        ws = self._require_ws()
        while self._pending:
            yield self._pending.pop(0)
        try:
            async for message in ws:
                raw = decode_frame(message)
                if raw is not None:
                    yield raw
        except ConnectionClosed:
            return

    def _require_ws(self) -> ClientConnection:
        if self._ws is None:
            raise RuntimeError("not connected; use voice_eval.targets.detect.open_target()")
        return self._ws
