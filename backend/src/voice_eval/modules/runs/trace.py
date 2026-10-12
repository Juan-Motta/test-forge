"""Trace waterfall of a run: the agent's Langfuse observations as rows for a timeline.

The judge saves the raw observations it read for the run's session to `langfuse.json` in the
run's artifacts (see `modules.judgements.coordinator`). Each row has its offset from the run
start (or from the first observation when the start is unknown), its duration, its depth under
`parentObservationId` (0 for roots and for parents that were not read) and a lowercase type:
`llm` for generations, `tool` for tool calls, otherwise Langfuse's own type (`span`, `event`,
...). Rows are sorted by start; stats are the judge digest's.
"""

from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from voice_eval.providers.langfuse_traces import (
    NAME_CHARS,
    _camel,
    _clip,
    _duration_ms,
    _is_tool,
    _number,
    _offset_ms,
    _parse_time,
    _stats,
    _usage,
    sort_observations,
)

STATUS_MESSAGE_CHARS = 500


def _type(observation: dict[str, Any]) -> str:
    kind = str(observation.get("type") or "").upper()
    if kind == "GENERATION":
        return "llm"
    if kind == "TOOL" or (kind in ("", "SPAN") and _is_tool(observation)):
        return "tool"
    return kind.lower() or "span"


def _cost(observation: dict[str, Any]) -> float | None:
    for key in ("calculatedTotalCost", "totalCost"):
        if (cost := _number(observation.get(key))) is not None:
            return cost
    details = observation.get("costDetails")
    return _number(details.get("total")) if isinstance(details, dict) else None


def _depths(rows: list[dict[str, Any]]) -> list[int]:
    parents = {
        str(row["id"]): str(row["parentObservationId"])
        for row in rows
        if row.get("id") and row.get("parentObservationId")
    }
    known = {str(row["id"]) for row in rows if row.get("id")}
    depths = []
    for row in rows:
        depth, seen = 0, {str(row.get("id"))}
        parent = parents.get(str(row.get("id")))
        while parent is not None and parent in known and parent not in seen:
            depth += 1
            seen.add(parent)
            parent = parents.get(parent)
        depths.append(depth)
    return depths


def build_trace(
    observations: Any, *, origin: datetime | None, note: str | None = None
) -> dict[str, Any]:
    """`{available, note, stats, observations}`; `available` is false without observations."""
    rows = (
        sort_observations(row for row in observations if isinstance(row, dict))
        if isinstance(observations, list)
        else []
    )
    if not rows:
        return {"available": False, "note": note, "stats": None, "observations": []}
    if origin is not None and origin.tzinfo is None:
        origin = origin.replace(tzinfo=UTC)
    if origin is None:
        origin = next((m for row in rows if (m := _parse_time(row.get("startTime")))), None)
    stats = _stats(rows, len({str(row.get("traceId") or "unknown") for row in rows}))
    items = []
    for row, depth in zip(rows, _depths(rows), strict=True):
        usage = _usage(row)
        items.append(
            {
                "id": _clip(row.get("id"), NAME_CHARS),
                "traceId": _clip(row.get("traceId"), NAME_CHARS),
                "parentId": _clip(row.get("parentObservationId"), NAME_CHARS),
                "type": _type(row),
                "name": _clip(row.get("name"), NAME_CHARS),
                "startMs": _offset_ms(_parse_time(row.get("startTime")), origin),
                "durationMs": _duration_ms(row),
                "model": _clip(row.get("model") or row.get("providedModelName"), NAME_CHARS),
                "tokens": usage["total"] if usage else None,
                "costUsd": _cost(row),
                "level": str(row.get("level") or "DEFAULT").upper(),
                "statusMessage": _clip(row.get("statusMessage"), STATUS_MESSAGE_CHARS),
                "depth": depth,
            }
        )
    return {
        "available": True,
        "note": note,
        "stats": {_camel(key): value for key, value in asdict(stats).items()},
        "observations": items,
    }
