"""Session plumbing shared by the scripted probe and the evaluator session runner."""

import asyncio
from collections.abc import Callable
from contextlib import suppress
from typing import Any

from websockets.exceptions import ConnectionClosed

from voice_eval.audio import BYTES_PER_MS
from voice_eval.ports.target import TargetSession
from voice_eval.turns import AgentTurn, AgentTurnDetector, ResponseTurnTracker

FALLBACK_GAP_MIN_MS = 5000  # tool runs tick every second; never end on a shorter gap there


def make_detector(
    session: TargetSession,
    *,
    silence_gap_ms: float,
    settle_ms: float,
    open_response_stall_ms: float,
) -> AgentTurnDetector:
    """Explicit response events (legacy) or an audio gap (Live) end an agent turn."""
    if session.explicit_turn_end:
        fallback = max(silence_gap_ms, FALLBACK_GAP_MIN_MS)
        stall = max(open_response_stall_ms, fallback)
        return ResponseTurnTracker(settle_ms, fallback, stall)
    return AgentTurnDetector(silence_gap_ms)


async def close_session(
    session: TargetSession,
    reader: "asyncio.Task[None]",
    *,
    timeout_s: float,
    on_close_sent: Callable[[dict[str, Any]], None] = lambda record: None,
) -> list[str]:
    """End the session gracefully, then always disconnect and stop the reader.

    `on_close_sent` gets what the adapter sent to close. Returns warnings (never raises for a
    peer that does not confirm the close in time).
    """
    warnings = []
    if not reader.done():
        try:
            on_close_sent(await asyncio.wait_for(session.close(), timeout_s))
            await asyncio.wait_for(asyncio.shield(reader), timeout_s)
        except (TimeoutError, ConnectionClosed):
            warnings.append("graceful session close not confirmed in time")
    with suppress(Exception):
        await session.disconnect()
    if not reader.done():
        reader.cancel()
        with suppress(asyncio.CancelledError):
            await reader
    return warnings


def rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def turn_record(index: int, turn: AgentTurn, kind: str) -> dict[str, Any]:
    """One agent turn's timings as written to `summary.json`."""
    return {
        "index": index,
        "kind": kind,
        "caller_end_ms": rounded(turn.caller_end_ms),
        "first_audio_ms": rounded(turn.first_audio_ms),
        "end_ms": rounded(turn.end_ms),
        "playback_end_ms": rounded(turn.playback_end_ms),
        "caller_resumed_ms": rounded(turn.caller_resumed_ms),
        "latency_ms": rounded(turn.latency_ms),
        "audio_ms": round(turn.audio_bytes / BYTES_PER_MS, 1),
        "response_count": turn.response_count,
        "tool_activity": turn.tool_activity,
        "end_reason": turn.end_reason,
    }
