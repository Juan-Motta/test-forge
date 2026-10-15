"""Judgement use cases over the database: start (or restart) a judgement and its transitions.

Each function runs in its own short transaction. A judging task's writes carry the attempt it
was started for and only apply while the judgement is still active with that attempt; a
translating task's writes apply only while the judgement is completed with that attempt.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import exists, null, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.judge.translation import LANGUAGES
from voice_eval.modules.judgements.domain import (
    ACTIVE_JUDGEMENT_STATUSES,
    TERMINAL_JUDGEMENT_STATUSES,
    Judgement,
    JudgementInProgress,
    JudgementNotTranslatable,
    JudgementStatus,
)
from voice_eval.modules.judgements.models import RunJudgementRecord
from voice_eval.modules.runs.domain import RunStatus, sanitize_error
from voice_eval.modules.runs.models import RunRecord
from voice_eval.ports.usage import merge_usage

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
                "translations": null(),
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
    """Store the result, its translations `pending` (the coordinator makes them next)."""
    return await _transition(
        db,
        run_id,
        attempt,
        status=JudgementStatus.COMPLETED.value,
        result=result,
        translations=_pending_translations(),
        model=model,
        error=None,
        completed_at=_now(),
    )


def _pending_translations() -> dict[str, Any]:
    return {language: {"status": "pending", "error": None} for language in LANGUAGES}


async def _locked(db: AsyncSession, run_id: uuid.UUID) -> RunJudgementRecord | None:
    return await db.scalar(
        select(RunJudgementRecord)
        .where(RunJudgementRecord.run_id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def set_translation(
    db: AsyncSession, run_id: uuid.UUID, attempt: int, language: str, entry: dict[str, Any]
) -> bool:
    """Store one language's translation entry while the judgement is still the completed
    `attempt` it was made from (a re-judge meanwhile drops it)."""
    record = await _locked(db, run_id)
    stored = (
        record is not None
        and record.attempt == attempt
        and record.status == JudgementStatus.COMPLETED.value
    )
    if stored:
        record.translations = {**(record.translations or {}), language: entry}
    await db.commit()
    return stored


async def request_translation(
    db: AsyncSession, run_id: uuid.UUID, language: str, *, restart_pending: bool
) -> tuple[Judgement, bool]:
    """Ask for the judgement's `language` version: `(judgement, started)`, where `started`
    says it was set `pending` and must be made now. A ready one is kept (nothing is paid
    twice); a pending one is restarted only with `restart_pending` (no task is making it).

    Raises `JudgementInProgress` while judging, `JudgementNotTranslatable` without a completed
    judgement.
    """
    record = await _locked(db, run_id)
    if record is not None and record.status in ACTIVE:
        await db.rollback()
        raise JudgementInProgress(str(run_id))
    if record is None or record.status != JudgementStatus.COMPLETED.value or not record.result:
        await db.rollback()
        raise JudgementNotTranslatable(str(run_id))
    status = record.to_domain().translation(language)["status"]
    started = status in ("none", "failed") or (status == "pending" and restart_pending)
    if started:
        record.translations = {
            **(record.translations or {}),
            language: {"status": "pending", "error": None},
        }
    judgement = record.to_domain()
    await db.commit()
    return judgement, started


async def pending_translations(db: AsyncSession) -> list[tuple[uuid.UUID, int, str]]:
    """`(run_id, attempt, language)` of every translation left pending on a completed
    judgement (at startup: no task survived)."""
    rows = await db.execute(
        select(
            RunJudgementRecord.run_id,
            RunJudgementRecord.attempt,
            RunJudgementRecord.translations,
        ).where(
            RunJudgementRecord.status == JudgementStatus.COMPLETED.value,
            RunJudgementRecord.translations.is_not(None),
        )
    )
    return [
        (run_id, attempt, language)
        for run_id, attempt, translations in rows
        if isinstance(translations, dict)
        for language, entry in translations.items()
        if isinstance(entry, dict) and entry.get("status") == "pending"
    ]


async def mark_failed(db: AsyncSession, run_id: uuid.UUID, attempt: int, error: str) -> bool:
    return await _transition(
        db,
        run_id,
        attempt,
        status=JudgementStatus.FAILED.value,
        error=sanitize_error(error),
        completed_at=_now(),
    )


async def add_usage(db: AsyncSession, run_id: uuid.UUID, usage: dict[str, Any] | None) -> None:
    """Add one judging attempt's model usage to the run's judge usage (every attempt, re-judges
    and failed ones included: they were billed). The row lock serializes concurrent writers."""
    if usage is None:
        return
    record = await _locked(db, run_id)
    if record is not None:
        record.usage = merge_usage(record.usage, usage)
    await db.commit()
