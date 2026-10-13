"""Criteria decided in code before the judge is asked: those whose evidence source is missing.

A `trace` criterion cannot be judged without the agent's traces, nor a `timing` criterion
without turn timings; guessing them from another source is what made scores drift, so they are
not sent as judgeable and become `not_observable` with a typed reason instead.
"""

from typing import Any

from voice_eval.judge.domain import UnobservableReason, snapshot_criteria

# Voice turns time audio (`caller_end_ms`...`playback_end_ms`); text replies time the first
# text (`first_text_ms`); both carry `end_ms` and `latency_ms`.
_TURN_TIMINGS = (
    "caller_end_ms",
    "first_audio_ms",
    "first_text_ms",
    "end_ms",
    "playback_end_ms",
    "latency_ms",
)


def _number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def has_timing_data(summary: Any) -> bool:
    """Whether the run summary has at least one measured turn timing or latency."""
    if not isinstance(summary, dict):
        return False
    latencies = summary.get("latencies_ms")
    if isinstance(latencies, list) and any(_number(value) for value in latencies):
        return True
    turns = summary.get("turns")
    return isinstance(turns, list) and any(
        isinstance(turn, dict) and any(_number(turn.get(key)) for key in _TURN_TIMINGS)
        for turn in turns
    )


def gate_criteria(
    criteria: list[Any], *, has_traces: bool, summary: Any
) -> dict[str, UnobservableReason]:
    """The ids of the snapshot `criteria` that cannot be judged, with why.

    Raises `JudgeError` when a criterion is malformed.
    """
    timing = has_timing_data(summary)
    gated: dict[str, UnobservableReason] = {}
    for criterion in snapshot_criteria(criteria):
        if criterion.source == "trace" and not has_traces:
            gated[criterion.id] = "traces_unavailable"
        elif criterion.source == "timing" and not timing:
            gated[criterion.id] = "no_timing_data"
    return gated
