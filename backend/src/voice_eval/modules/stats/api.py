"""HTTP API of the stats module: `/api/stats/*` (behind authentication)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.stats import service
from voice_eval.platform.db import get_db_session

Db = Annotated[AsyncSession, Depends(get_db_session)]
MAX_DAYS = 90


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class RunCountsOut(CamelModel):
    count: int  # runs created in the window
    previous_count: int  # runs created in the window of the same length just before


class LatencyOut(CamelModel):
    p50_ms: int | None  # over every response latency of the window's runs
    p95_ms: int | None


class LiveOut(CamelModel):
    active: int  # runs queued, connecting or running now (any age)


class WeakCriterionOut(CamelModel):
    text: str
    scenario_name: str
    average_score: float  # 0-100, over the judgements that scored it
    judged: int


class SuggestionCountsOut(CamelModel):
    open: int  # suggestions of the window's completed judgements
    high_priority: int


class OverviewOut(CamelModel):
    period_days: int
    runs: RunCountsOut
    average_score: float | None  # mean overall score (0-100) of completed judgements
    goal_completion: float | None  # 0..1: completed judgements whose must criteria passed
    latency: LatencyOut
    live: LiveOut
    weakest_criteria: list[WeakCriterionOut]  # lowest average first, at most 5
    suggestions: SuggestionCountsOut


router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview", response_model=OverviewOut)
async def get_overview(db: Db, days: Annotated[int, Query(ge=1, le=MAX_DAYS)] = 7) -> OverviewOut:
    """Aggregates over the runs created in the last `days` days; null when there is no data."""
    stats = await service.overview(db, days=days)
    return OverviewOut(
        period_days=stats.period_days,
        runs=RunCountsOut(count=stats.runs, previous_count=stats.previous_runs),
        average_score=stats.average_score,
        goal_completion=stats.goal_completion,
        latency=LatencyOut(p50_ms=stats.latency_p50_ms, p95_ms=stats.latency_p95_ms),
        live=LiveOut(active=stats.active_runs),
        weakest_criteria=[
            WeakCriterionOut(
                text=item.text,
                scenario_name=item.scenario_name,
                average_score=item.average_score,
                judged=item.judged,
            )
            for item in stats.weakest_criteria
        ],
        suggestions=SuggestionCountsOut(
            open=stats.suggestions, high_priority=stats.high_priority_suggestions
        ),
    )
