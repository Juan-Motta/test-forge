"""Open a target session, detecting which protocol the backend chose for the agent."""

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

from websockets.asyncio.client import ClientConnection
from websockets.exceptions import ConnectionClosed

from voice_eval.ports.target import TargetSession
from voice_eval.targets.connection import decode_frame, open_socket, realtime_url
from voice_eval.targets.vivi_live import ViviLiveClient
from voice_eval.targets.vivi_realtime import ViviRealtimeClient

ProtocolName = Literal["auto", "live", "realtime"]
DetectedProtocol = Literal["live", "realtime"]
PROTOCOLS: tuple[ProtocolName, ...] = ("auto", "live", "realtime")
MAX_DETECT_FRAMES = 10


class ProtocolDetectionError(RuntimeError):
    pass


@dataclass(frozen=True)
class TargetSpec:
    base_url: str
    channel_id: str
    user_id: str
    thread_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    origin: str | None = None
    protocol: ProtocolName = "auto"


async def open_target(spec: TargetSpec, detect_timeout_s: float = 15) -> TargetSession:
    """Connect; the first frame decides the protocol: `voice.*` is Live, `session.*` legacy.

    A forced `spec.protocol` is checked against that frame and fails fast on a mismatch: each
    server closes the session on the other protocol's client events, so guessing is never safe.
    """
    url = realtime_url(spec.base_url, spec.channel_id, spec.user_id, spec.thread_id)
    ws = await open_socket(url, spec.origin)
    try:
        try:
            protocol, pending = await asyncio.wait_for(detect_protocol(ws), detect_timeout_s)
        except TimeoutError:
            raise ProtocolDetectionError("no protocol-identifying frame received in time") from None
        check_forced_protocol(spec, protocol, pending)
    except BaseException:
        await ws.close()
        raise
    return attach_session(spec, ws, protocol, pending)


def check_forced_protocol(
    spec: TargetSpec, protocol: DetectedProtocol, pending: list[dict[str, Any]]
) -> None:
    """Raise `ProtocolDetectionError` when `spec.protocol` forces the other protocol."""
    if spec.protocol not in ("auto", protocol):
        raise ProtocolDetectionError(
            f"--protocol {spec.protocol} was forced but the server speaks the {protocol} "
            f"protocol (first identifying frame: {pending[-1].get('type')!r})"
        )


def attach_session(
    spec: TargetSpec,
    ws: ClientConnection,
    protocol: DetectedProtocol,
    pending: list[dict[str, Any]],
) -> TargetSession:
    """The adapter of `protocol` over an open socket whose first frames (`pending`) were read."""
    adapter = ViviLiveClient if protocol == "live" else ViviRealtimeClient
    client = adapter(spec.base_url, spec.channel_id, spec.user_id, spec.thread_id, spec.origin)
    client.attach(ws, pending)
    return client


async def detect_protocol(ws: ClientConnection) -> tuple[DetectedProtocol, list[dict[str, Any]]]:
    """Read frames until one identifies the protocol; returns it and every frame read."""
    pending: list[dict[str, Any]] = []
    while len(pending) < MAX_DETECT_FRAMES:
        try:
            message = await ws.recv()
        except ConnectionClosed as exc:
            raise ProtocolDetectionError(
                f"socket closed before the protocol was identified: {exc.rcvd!r}"
            ) from None
        raw = decode_frame(message)
        if raw is None:
            continue
        pending.append(raw)
        kind = str(raw.get("type", ""))
        if kind.startswith("voice."):
            return "live", pending
        if kind.startswith("session."):
            return "realtime", pending
    seen = [raw.get("type") for raw in pending]
    raise ProtocolDetectionError(f"unrecognized protocol; first frame types: {seen}")
