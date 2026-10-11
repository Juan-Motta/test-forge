"""Runs use cases over the database: launch checks, batches, run state transitions and queries.

The task manager (`modules.runs.manager`) drives the conversations; everything it persists goes
through the functions here, each in its own short transaction.
"""

import uuid
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Integer, Numeric, Select, case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.agents.models import AgentRecord
from voice_eval.modules.judgements.domain import JudgementStatus
from voice_eval.modules.judgements.models import RunJudgementRecord
from voice_eval.modules.runs.domain import (
    ACTIVE_BATCH_STATUSES,
    ACTIVE_RUN_STATUSES,
    Batch,
    BatchNotFound,
    BatchStatus,
    Run,
    RunNotFound,
    RunPlan,
    RunStatus,
    ScenariosNotRunnable,
    sanitize_error,
    snapshot,
)
from voice_eval.modules.runs.models import RunBatchRecord, RunRecord
from voice_eval.modules.scenarios import service as scenarios
from voice_eval.modules.scenarios.domain import ScenarioNotFound, ScenarioNotRunnable

ACTIVE_RUNS = [status.value for status in ACTIVE_RUN_STATUSES]
ACTIVE_BATCHES = [status.value for status in ACTIVE_BATCH_STATUSES]


def _now() -> datetime:
    return datetime.now(UTC)


async def _plan(db: AsyncSession, scenario_id: uuid.UUID) -> RunPlan:
    """Resolve one scenario for launch; raises `ScenarioNotRunnable` with the reason."""
    try:
        scenario = await scenarios.get_scenario(db, scenario_id)
    except ScenarioNotFound:
        raise ScenarioNotRunnable("scenario not found") from None
    tts = await scenarios.connection_ref(db, scenario.tts_connection_id)
    if tts is None:
        raise ScenarioNotRunnable("choose a voice (TTS) connection for this scenario")
    evaluator = await scenarios.evaluator_connection(db, scenario)
    agent = await db.get(AgentRecord, scenario.agent.id, populate_existing=True)
    if agent is None:
        raise ScenarioNotRunnable("the scenario's agent no longer exists")
    return RunPlan(scenario=scenario, agent=agent.to_domain(), tts=tts, evaluator=evaluator)


async def plan_runs(db: AsyncSession, scenario_ids: list[uuid.UUID]) -> list[RunPlan]:
    """Every scenario resolved for launch, or `ScenariosNotRunnable` listing each refusal."""
    plans, errors = [], []
    for index, scenario_id in enumerate(scenario_ids):
        try:
            plans.append(await _plan(db, scenario_id))
        except ScenarioNotRunnable as exc:
            errors.append({"index": index, "scenario_id": scenario_id, "msg": exc.reason})
    if errors:
        raise ScenariosNotRunnable(errors)
    return plans


async def create_batch(
    db: AsyncSession,
    plans: list[RunPlan],
    *,
    repetitions: int,
    concurrency: int,
    label: str | None,
    created_by: uuid.UUID | None,
) -> Batch:
    """A queued batch: every plan `repetitions` times, interleaved (first round, second...)."""
    batch = RunBatchRecord(
        id=uuid.uuid4(),
        label=label,
        concurrency=concurrency,
        status=BatchStatus.QUEUED.value,
        total_runs=len(plans) * repetitions,
        created_by=created_by,
    )
    db.add(batch)
    await db.flush()
    snapshots = [snapshot(plan) for plan in plans]
    for round_ in range(repetitions):
        for index, plan in enumerate(plans):
            db.add(
                RunRecord(
                    id=uuid.uuid4(),
                    batch_id=batch.id,
                    position=round_ * len(plans) + index,
                    scenario_id=plan.scenario.id,
                    agent_id=plan.agent.id,
                    thread_id=str(uuid.uuid4()),
                    status=RunStatus.QUEUED.value,
                    snapshot=snapshots[index],
                )
            )
    await db.commit()
    return await get_batch(db, batch.id, with_runs=True)


# --- queries ------------------------------------------------------------------------------


def _overall_score():
    """The stored overall score as an integer, or NULL when it is not a number in 0..100: one
    malformed result must never break a whole list. Nested CASEs fix the evaluation order, so
    the cast only ever sees a JSON number."""
    raw = RunJudgementRecord.result["overallScore"]
    number = raw.astext.cast(Numeric)
    in_range = case((number.between(0, 100), func.round(number).cast(Integer)), else_=None)
    return case((func.jsonb_typeof(raw) == "number", in_range), else_=None)


def _with_judgement() -> Select:
    """Runs with their judgement's status and, once completed, its overall score (one join)."""
    return (
        select(RunRecord, RunJudgementRecord.status, _overall_score())
        .outerjoin(RunJudgementRecord, RunJudgementRecord.run_id == RunRecord.id)
        .execution_options(populate_existing=True)
    )


def _run(record: RunRecord, judgement_status: str | None, score: int | None) -> Run:
    completed = judgement_status == JudgementStatus.COMPLETED.value
    return replace(
        record.to_domain(),
        judgement_status=judgement_status,
        score=score if completed else None,
    )


async def get_run(db: AsyncSession, run_id: uuid.UUID) -> Run:
    row = (await db.execute(_with_judgement().where(RunRecord.id == run_id))).one_or_none()
    if row is None:
        raise RunNotFound(str(run_id))
    return _run(*row)


async def list_runs(
    db: AsyncSession,
    *,
    status: RunStatus | None = None,
    scenario_id: uuid.UUID | None = None,
    batch_id: uuid.UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Run], int]:
    """A page of runs, newest first (a batch's runs in launch order), and the total count."""
    conditions = []
    if status is not None:
        conditions.append(RunRecord.status == status.value)
    if scenario_id is not None:
        conditions.append(RunRecord.scenario_id == scenario_id)
    if batch_id is not None:
        conditions.append(RunRecord.batch_id == batch_id)
    total = await db.scalar(select(func.count()).select_from(RunRecord).where(*conditions))
    rows = await db.execute(
        _with_judgement()
        .where(*conditions)
        .order_by(RunRecord.created_at.desc(), RunRecord.batch_id, RunRecord.position)
        .limit(limit)
        .offset(offset)
    )
    return [_run(*row) for row in rows], total or 0


async def _counts(db: AsyncSession, batch_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, int]]:
    rows = await db.execute(
        select(RunRecord.batch_id, RunRecord.status, func.count())
        .where(RunRecord.batch_id.in_(batch_ids))
        .group_by(RunRecord.batch_id, RunRecord.status)
    )
    counts: dict[uuid.UUID, dict[str, int]] = {batch_id: {} for batch_id in batch_ids}
    for batch_id, status, count in rows:
        counts[batch_id][status] = count
    return counts


def _batch(record: RunBatchRecord, counts: dict[str, int], runs: list[Run] | None) -> Batch:
    return Batch(
        id=record.id,
        label=record.label,
        concurrency=record.concurrency,
        status=BatchStatus(record.status),
        total=record.total_runs,
        counts=counts,
        created_by=record.created_by,
        created_at=record.created_at,
        runs=runs,
    )


async def get_batch(db: AsyncSession, batch_id: uuid.UUID, *, with_runs: bool = False) -> Batch:
    record = await db.get(RunBatchRecord, batch_id, populate_existing=True)
    if record is None:
        raise BatchNotFound(str(batch_id))
    runs = None
    if with_runs:
        runs, _ = await list_runs(db, batch_id=batch_id, limit=record.total_runs)
    return _batch(record, (await _counts(db, [batch_id]))[batch_id], runs)


async def list_batches(
    db: AsyncSession, *, limit: int = 50, offset: int = 0
) -> tuple[list[Batch], int]:
    total = await db.scalar(select(func.count()).select_from(RunBatchRecord))
    records = list(
        await db.scalars(
            select(RunBatchRecord)
            .order_by(RunBatchRecord.created_at.desc(), RunBatchRecord.id)
            .limit(limit)
            .offset(offset)
            .execution_options(populate_existing=True)
        )
    )
    counts = await _counts(db, [record.id for record in records])
    return [_batch(record, counts[record.id], None) for record in records], total or 0


async def active_run_ids(db: AsyncSession, batch_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        await db.scalars(
            select(RunRecord.id).where(
                RunRecord.batch_id == batch_id, RunRecord.status.in_(ACTIVE_RUNS)
            )
        )
    )


# --- transitions --------------------------------------------------------------------------


async def mark_started(db: AsyncSession, run_id: uuid.UUID, batch_id: uuid.UUID) -> None:
    """`queued` -> `connecting`; the batch is running from its first started run."""
    await db.execute(
        update(RunRecord)
        .where(RunRecord.id == run_id, RunRecord.status == RunStatus.QUEUED.value)
        .values(status=RunStatus.CONNECTING.value, started_at=_now())
    )
    await db.execute(
        update(RunBatchRecord)
        .where(RunBatchRecord.id == batch_id, RunBatchRecord.status == BatchStatus.QUEUED.value)
        .values(status=BatchStatus.RUNNING.value)
    )
    await db.commit()


async def mark_running(db: AsyncSession, run_id: uuid.UUID) -> None:
    await db.execute(
        update(RunRecord)
        .where(RunRecord.id == run_id, RunRecord.status == RunStatus.CONNECTING.value)
        .values(status=RunStatus.RUNNING.value)
    )
    await db.commit()


async def mark_finished(
    db: AsyncSession,
    run_id: uuid.UUID,
    batch_id: uuid.UUID,
    *,
    status: RunStatus,
    reason: str | None,
    summary: dict[str, Any] | None,
    artifacts_dir: str | None,
    error: str | None,
) -> bool:
    """Record the terminal state (once), then complete the batch when nothing is left.

    Returns whether this call recorded it (False when the run had already ended).
    """
    result = await db.execute(
        update(RunRecord)
        .where(RunRecord.id == run_id, RunRecord.status.in_(ACTIVE_RUNS))
        .values(
            status=status.value,
            end_reason=reason,
            summary=summary,
            artifacts_dir=artifacts_dir,
            error=sanitize_error(error),
            ended_at=_now(),
        )
    )
    await _settle_batch(db, batch_id)
    await db.commit()
    return result.rowcount > 0


async def _settle_batch(db: AsyncSession, batch_id: uuid.UUID) -> None:
    """Complete the batch once no run is left; the row lock serializes concurrent run ends."""
    await db.execute(
        select(RunBatchRecord.id).where(RunBatchRecord.id == batch_id).with_for_update()
    )
    if await active_run_ids(db, batch_id):
        return
    await db.execute(
        update(RunBatchRecord)
        .where(RunBatchRecord.id == batch_id, RunBatchRecord.status.in_(ACTIVE_BATCHES))
        .values(status=BatchStatus.COMPLETED.value)
    )


async def mark_batch_cancelled(db: AsyncSession, batch_id: uuid.UUID) -> bool:
    """Whether the batch was still active (and is now `cancelled`)."""
    result = await db.execute(
        update(RunBatchRecord)
        .where(RunBatchRecord.id == batch_id, RunBatchRecord.status.in_(ACTIVE_BATCHES))
        .values(status=BatchStatus.CANCELLED.value)
    )
    await db.commit()
    return result.rowcount > 0


async def mark_interrupted(db: AsyncSession) -> int:
    """At startup: no task survived the previous process, so its unfinished runs are over."""
    result = await db.execute(
        update(RunRecord)
        .where(RunRecord.status.in_(ACTIVE_RUNS))
        .values(status=RunStatus.INTERRUPTED.value, end_reason="server_restarted", ended_at=_now())
    )
    await db.execute(
        update(RunBatchRecord)
        .where(RunBatchRecord.status.in_(ACTIVE_BATCHES))
        .values(status=BatchStatus.COMPLETED.value)
    )
    await db.commit()
    return result.rowcount
