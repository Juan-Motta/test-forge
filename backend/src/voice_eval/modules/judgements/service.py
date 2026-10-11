"""Judgement use cases over the database: start (or restart) a judgement and its transitions.

Each function runs in its own short transaction. A judging task's writes carry the attempt it
was started for and only apply while the judgement is still active with that attempt.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import exists, null, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.judgements.domain import (
    ACTIVE_JUDGEMENT_STATUSES,
    TERMINAL_JUDGEMENT_STATUSES,
    Judgement,
    JudgementStatus,
)
from voice_eval.modules.judgements.models import RunJudgementRecord
from voice_eval.modules.runs.domain import RunStatus, sanitize_error
from voice_eval.modules.runs.models import RunRecord

ACTIVE = [status.value for status in ACTIVE_JUDGEMENT_STATUSES]
TERMINAL = [status.value for status in TERMINAL_JUDGEMENT_STATUSES]


def _now() -> datetime:
    return datetime.now(UTC)


async def get_judgement(db: AsyncSession, run_id: uuid.UUID) -> Judgement | None:
    record = await db.get(RunJudgementRecord, run_id, populate_existing=True)
    return record.to_domain() if record is not None else None


async def start(db: AsyncSession, run_id: uuid.UUID) -> Judgement | None:
    """A fresh `pending` judgement (attempt 1), or the finished one reset with the next attempt.

    Returns None, changing nothing, while the run's judgement is still active.
    """
    now = _now()
    table = RunJudgementRecord.__table__
    statement = (
        insert(RunJudgementRecord)
        .values(run_id=run_id, status=JudgementStatus.PENDING.value, attempt=1, updated_at=now)
        .on_conflict_do_update(
            index_elements=[table.c.run_id],
            set_={
                "status": JudgementStatus.PENDING.value,
                "result": null(),
                "trace_stats": null(),
                "trace_note": None,
                "error": None,
                "model": None,
                "attempt": table.c.attempt + 1,
                "created_at": now,
                "updated_at": now,
                "completed_at": None,
            },
            where=table.c.status.in_(TERMINAL),
        )
        .returning(table.c.run_id)
    )
    started = (await db.execute(statement)).scalar_one_or_none()
    await db.commit()
    if started is None:
        return None
    return await get_judgement(db, run_id)


async def start_missing(db: AsyncSession, run_id: uuid.UUID) -> Judgement | None:
    """A fresh `pending` judgement (attempt 1) only when the run has none yet; else None."""
    statement = (
        insert(RunJudgementRecord)
        .values(run_id=run_id, status=JudgementStatus.PENDING.value, attempt=1, updated_at=_now())
        .on_conflict_do_nothing(index_elements=[RunJudgementRecord.__table__.c.run_id])
        .returning(RunJudgementRecord.run_id)
    )
    started = (await db.execute(statement)).scalar_one_or_none()
    await db.commit()
    if started is None:
        return None
    return await get_judgement(db, run_id)


async def unjudged_finished_runs(
    db: AsyncSession, *, ended_since: datetime
) -> list[tuple[uuid.UUID, RunStatus, dict[str, Any] | None]]:
    """`(run_id, status, summary)` of completed or failed runs that ended since `ended_since`
    and have no judgement row; the caller decides which of them are judgeable."""
    judged = exists().where(RunJudgementRecord.run_id == RunRecord.id)
    rows = await db.execute(
        select(RunRecord.id, RunRecord.status, RunRecord.summary)
        .where(
            RunRecord.status.in_([RunStatus.COMPLETED.value, RunStatus.FAILED.value]),
            RunRecord.ended_at >= ended_since,
            ~judged,
        )
        .order_by(RunRecord.ended_at)
    )
    return [(run_id, RunStatus(status), summary) for run_id, status, summary in rows]


async def active_judgements(db: AsyncSession) -> list[tuple[uuid.UUID, int]]:
    """`(run_id, attempt)` of every judgement left unfinished (at startup: no task survived)."""
    rows = await db.execute(
        select(RunJudgementRecord.run_id, RunJudgementRecord.attempt).where(
            RunJudgementRecord.status.in_(ACTIVE)
        )
    )
    return [(run_id, attempt) for run_id, attempt in rows]


async def _transition(db: AsyncSession, run_id: uuid.UUID, attempt: int, **values: Any) -> bool:
    result = await db.execute(
        update(RunJudgementRecord)
        .where(
            RunJudgementRecord.run_id == run_id,
            RunJudgementRecord.attempt == attempt,
            RunJudgementRecord.status.in_(ACTIVE),
        )
        .values(updated_at=_now(), **values)
    )
    await db.commit()
    return result.rowcount > 0


async def mark_collecting(db: AsyncSession, run_id: uuid.UUID, attempt: int) -> bool:
    return await _transition(db, run_id, attempt, status=JudgementStatus.COLLECTING_TRACES.value)


async def mark_judging(
    db: AsyncSession,
    run_id: uuid.UUID,
    attempt: int,
    *,
    trace_stats: dict[str, Any] | None,
    trace_note: str | None,
) -> bool:
    """The trace evidence is settled (stats and/or a note); the model call comes next."""
    return await _transition(
        db,
        run_id,
        attempt,
        status=JudgementStatus.JUDGING.value,
        trace_stats=trace_stats if trace_stats is not None else null(),
        trace_note=trace_note,
    )


async def mark_completed(
    db: AsyncSession, run_id: uuid.UUID, attempt: int, *, result: dict[str, Any], model: str
) -> bool:
    return await _transition(
        db,
        run_id,
        attempt,
        status=JudgementStatus.COMPLETED.value,
        result=result,
        model=model,
        error=None,
        completed_at=_now(),
    )


async def mark_failed(db: AsyncSession, run_id: uuid.UUID, attempt: int, error: str) -> bool:
    return await _transition(
        db,
        run_id,
        attempt,
        status=JudgementStatus.FAILED.value,
        error=sanitize_error(error),
        completed_at=_now(),
    )
