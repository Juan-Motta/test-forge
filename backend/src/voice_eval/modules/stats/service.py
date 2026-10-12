"""Overview aggregates over the runs created in a window of days and their judgements.

Rows are read with only the JSON fields the aggregates need (scores, criteria, suggestions,
latencies) and reduced in Python: the window bounds the work.
"""

import math
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.judgements.domain import JudgementStatus
from voice_eval.modules.judgements.models import RunJudgementRecord
from voice_eval.modules.runs.domain import ACTIVE_RUN_STATUSES
from voice_eval.modules.runs.models import RunRecord

WEAKEST_CRITERIA = 5


@dataclass(frozen=True)
class WeakCriterion:
    text: str
    scenario_name: str
    average_score: float
    judged: int


@dataclass(frozen=True)
class Overview:
    period_days: int
    runs: int
    previous_runs: int
    average_score: float | None
    goal_completion: float | None  # share of completed judgements whose must criteria passed
    latency_p50_ms: int | None
    latency_p95_ms: int | None
    active_runs: int
    weakest_criteria: list[WeakCriterion] = field(default_factory=list)
    suggestions: int = 0
    high_priority_suggestions: int = 0


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) else None


def percentile(ordered: list[float], fraction: float) -> float:
    """Linear interpolation between the closest ranks of a sorted, non-empty list."""
    position = (len(ordered) - 1) * fraction
    low = math.floor(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


async def _count(db: AsyncSession, *conditions: Any) -> int:
    return await db.scalar(select(func.count()).select_from(RunRecord).where(*conditions)) or 0


async def overview(db: AsyncSession, *, days: int, now: datetime | None = None) -> Overview:
    now = now or datetime.now(UTC)
    start = now - timedelta(days=days)
    in_window = (RunRecord.created_at >= start, RunRecord.created_at < now)
    runs = await _count(db, *in_window)
    previous = await _count(
        db, RunRecord.created_at >= start - timedelta(days=days), RunRecord.created_at < start
    )
    active = await _count(db, RunRecord.status.in_([s.value for s in ACTIVE_RUN_STATUSES]))

    latencies: list[float] = []
    for values in await db.scalars(select(RunRecord.summary["latencies_ms"]).where(*in_window)):
        if isinstance(values, list):
            latencies.extend(v for value in values if (v := _number(value)) is not None)
    latencies.sort()

    result = RunJudgementRecord.result
    judged = await db.execute(
        select(
            RunRecord.scenario_id,
            RunRecord.snapshot["scenario"]["id"].astext,
            RunRecord.snapshot["scenario"]["name"].astext,
            result["overallScore"],
            result["mustFailed"],
            result["criteria"],
            result["suggestions"],
        )
        .join(RunJudgementRecord, RunJudgementRecord.run_id == RunRecord.id)
        .where(*in_window, RunJudgementRecord.status == JudgementStatus.COMPLETED.value)
        .order_by(RunRecord.created_at)
    )
    scores: list[float] = []
    goals = completed = suggestions = high = 0
    criteria: dict[tuple[str, str], list[float]] = defaultdict(list)
    names: dict[tuple[str, str], str] = {}
    for scenario_id, snapshot_id, name, score, must_failed, rows, advice in judged:
        completed += 1
        if (value := _number(score)) is not None:
            scores.append(value)
        if must_failed is False:
            goals += 1
        if isinstance(advice, list):
            items = [item for item in advice if isinstance(item, dict)]
            suggestions += len(items)
            high += sum(1 for item in items if item.get("priority") == "high")
        scenario = str(scenario_id or snapshot_id or uuid.UUID(int=0))
        for row in rows if isinstance(rows, list) else []:
            text = row.get("text") if isinstance(row, dict) else None
            if not isinstance(text, str):
                continue
            key = (scenario, text)
            names[key] = name or ""  # the newest run's name of the scenario
            if (value := _number(row.get("score"))) is not None:
                criteria[key].append(value)

    weakest = sorted(
        (
            WeakCriterion(
                text=text,
                scenario_name=names[(scenario, text)],
                average_score=round(sum(values) / len(values), 1),
                judged=len(values),
            )
            for (scenario, text), values in criteria.items()
            if values
        ),
        key=lambda item: (item.average_score, item.scenario_name, item.text),
    )[:WEAKEST_CRITERIA]
    return Overview(
        period_days=days,
        runs=runs,
        previous_runs=previous,
        average_score=round(sum(scores) / len(scores), 1) if scores else None,
        goal_completion=round(goals / completed, 4) if completed else None,
        latency_p50_ms=round(percentile(latencies, 0.5)) if latencies else None,
        latency_p95_ms=round(percentile(latencies, 0.95)) if latencies else None,
        active_runs=active,
        weakest_criteria=weakest,
        suggestions=suggestions,
        high_priority_suggestions=high,
    )
