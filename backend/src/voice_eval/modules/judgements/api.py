"""HTTP API of the judgements module: `/api/runs/{run_id}/judgement` (behind authentication).

The judging itself happens in the coordinator (`app.state.judgements`); this reads the stored
judgement and asks for a new one. The result is stored with camelCase keys and returned as is.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.judgements import service
from voice_eval.modules.judgements.coordinator import JudgementCoordinator
from voice_eval.modules.judgements.domain import Judgement, JudgementInProgress, JudgementStatus
from voice_eval.modules.runs import service as runs
from voice_eval.modules.runs.api import CamelModel
from voice_eval.modules.runs.domain import Run, RunNotFound
from voice_eval.platform.db import get_db_session

Db = Annotated[AsyncSession, Depends(get_db_session)]


def coordinator(request: Request) -> JudgementCoordinator:
    return request.app.state.judgements


Coordinator = Annotated[JudgementCoordinator, Depends(coordinator)]


class NoJudgementOut(CamelModel):
    status: Literal["none"] = "none"


class JudgementOut(CamelModel):
    status: JudgementStatus
    result: dict[str, Any] | None
    trace_stats: dict[str, Any] | None
    trace_note: str | None
    error: str | None
    model: str | None
    attempt: int
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None

    @classmethod
    def of(cls, judgement: Judgement) -> "JudgementOut":
        return cls(
            status=judgement.status,
            result=judgement.result,
            trace_stats=judgement.trace_stats,
            trace_note=judgement.trace_note,
            error=judgement.error,
            model=judgement.model,
            attempt=judgement.attempt,
            created_at=judgement.created_at,
            updated_at=judgement.updated_at,
            completed_at=judgement.completed_at,
        )


async def _run(db: AsyncSession, run_id: uuid.UUID) -> Run:
    try:
        return await runs.get_run(db, run_id)
    except RunNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found") from None


router = APIRouter(prefix="/runs", tags=["judgements"])


@router.get("/{run_id}/judgement", response_model=JudgementOut | NoJudgementOut)
async def get_judgement(run_id: uuid.UUID, db: Db) -> JudgementOut | NoJudgementOut:
    """The run's judgement, or `{"status": "none"}` when it was never judged."""
    await _run(db, run_id)
    judgement = await service.get_judgement(db, run_id)
    return JudgementOut.of(judgement) if judgement is not None else NoJudgementOut()


@router.post(
    "/{run_id}/judgement", response_model=JudgementOut, status_code=status.HTTP_202_ACCEPTED
)
async def rejudge(run_id: uuid.UUID, db: Db, judgements: Coordinator) -> JudgementOut:
    """Judge the run again, replacing the previous result. 409 while the run or a judgement of
    it is still in progress."""
    run = await _run(db, run_id)
    if not run.finished:
        raise HTTPException(status.HTTP_409_CONFLICT, "Run still in progress")
    try:
        judgement = await judgements.rejudge(run_id)
    except JudgementInProgress:
        raise HTTPException(status.HTTP_409_CONFLICT, "Judgement already in progress") from None
    return JudgementOut.of(judgement)
