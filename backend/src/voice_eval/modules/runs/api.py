"""HTTP API of the runs module: `/api/runs/*` (behind authentication).

Launching validates that every scenario can run (a voice connection and an evaluator model),
creates the batch with one queued run per scenario and repetition, and hands it to the task
manager (`app.state.runs`). Each run carries its judgement's status and score (the judgement
itself is served by `modules.judgements.api`). Summaries, transcripts and snapshots are
returned with camelCase keys.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.runs import service
from voice_eval.modules.runs.domain import (
    MAX_BATCH_CONCURRENCY,
    MAX_LABEL_LENGTH,
    MAX_REPETITIONS,
    MAX_SCENARIOS_PER_BATCH,
    Batch,
    BatchNotFound,
    Run,
    RunNotFound,
    RunStatus,
    ScenariosNotRunnable,
)
from voice_eval.modules.runs.manager import RunManager, read_json
from voice_eval.modules.users.deps import Principal, current_principal
from voice_eval.platform.db import get_db_session

CANCEL_STATUSES = frozenset({RunStatus.CANCELLED, RunStatus.INTERRUPTED})
Db = Annotated[AsyncSession, Depends(get_db_session)]
CurrentPrincipal = Annotated[Principal, Depends(current_principal)]
Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]
Label = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_LABEL_LENGTH)
]


def manager(request: Request) -> RunManager:
    return request.app.state.runs


Manager = Annotated[RunManager, Depends(manager)]


def camelize(value: Any) -> Any:
    """JSON data with every object key in camelCase (values untouched)."""
    if isinstance(value, dict):
        return {to_camel(str(key)): camelize(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [camelize(item) for item in value]
    return value


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class LaunchIn(CamelModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    scenario_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_SCENARIOS_PER_BATCH)
    repetitions: int = Field(default=1, ge=1, le=MAX_REPETITIONS)
    concurrency: int = Field(default=1, ge=1, le=MAX_BATCH_CONCURRENCY)
    label: Label | None = None


class RunOut(CamelModel):
    id: uuid.UUID
    batch_id: uuid.UUID
    position: int
    scenario_id: uuid.UUID | None
    scenario_name: str
    agent_id: uuid.UUID | None
    agent_name: str
    thread_id: str
    status: RunStatus
    end_reason: str | None
    error: str | None
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    judgement_status: str | None  # None until the run is handed to the judge
    score: int | None  # the judgement's overall score (0-100), once completed
    persona: str | None  # the scenario persona's name, from the snapshot
    caller_turns: int | None  # from the summary, once the run finished
    agent_turns: int | None
    latency_p50_ms: int | None  # median response latency of the summary

    @classmethod
    def fields_of(cls, run: Run) -> dict[str, Any]:
        return {
            "id": run.id,
            "batch_id": run.batch_id,
            "position": run.position,
            "scenario_id": run.scenario_id,
            "scenario_name": run.scenario_name,
            "agent_id": run.agent_id,
            "agent_name": run.agent_name,
            "thread_id": run.thread_id,
            "status": run.status,
            "end_reason": run.end_reason,
            "error": run.error,
            "created_at": run.created_at,
            "started_at": run.started_at,
            "ended_at": run.ended_at,
            "judgement_status": run.judgement_status,
            "score": run.score,
            "persona": run.persona,
            "caller_turns": run.caller_turns,
            "agent_turns": run.agent_turns,
            "latency_p50_ms": run.latency_p50_ms,
        }

    @classmethod
    def of(cls, run: Run) -> "RunOut":
        return cls(**cls.fields_of(run))


class RunDetailOut(RunOut):
    """`summary` is `summary.json`, `transcript` is `transcript.json` (once the run finished)."""

    summary: dict[str, Any] | None
    transcript: list[dict[str, Any]] | None
    snapshot: dict[str, Any]


class RunPage(CamelModel):
    items: list[RunOut]
    total: int


class BatchOut(CamelModel):
    id: uuid.UUID
    label: str | None
    concurrency: int
    status: str
    total: int
    counts: dict[str, int]  # runs per status
    created_by: uuid.UUID | None
    created_at: datetime

    @classmethod
    def fields_of(cls, batch: Batch) -> dict[str, Any]:
        return {
            "id": batch.id,
            "label": batch.label,
            "concurrency": batch.concurrency,
            "status": batch.status.value,
            "total": batch.total,
            "counts": batch.counts,
            "created_by": batch.created_by,
            "created_at": batch.created_at,
        }


class BatchDetailOut(BatchOut):
    runs: list[RunOut]

    @classmethod
    def of(cls, batch: Batch) -> "BatchDetailOut":
        return cls(**cls.fields_of(batch), runs=[RunOut.of(run) for run in batch.runs or []])


class BatchPage(CamelModel):
    items: list[BatchOut]
    total: int


def _not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


def _not_runnable(exc: ScenariosNotRunnable) -> HTTPException:
    """Same `{type, loc, msg}` items as request validation errors, plus the scenario id."""
    detail = [
        {
            "type": "value_error",
            "loc": ["body", "scenarioIds", error["index"]],
            "msg": error["msg"],
            "scenarioId": str(error["scenario_id"]),
        }
        for error in exc.errors
    ]
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


router = APIRouter(prefix="/runs", tags=["runs"])


@router.post("", response_model=BatchDetailOut, status_code=status.HTTP_201_CREATED)
async def launch(
    body: LaunchIn, principal: CurrentPrincipal, db: Db, runs: Manager
) -> BatchDetailOut:
    scenario_ids = list(dict.fromkeys(body.scenario_ids))  # a repeat is what repetitions are for
    try:
        plans = await service.plan_runs(db, scenario_ids)
    except ScenariosNotRunnable as exc:
        raise _not_runnable(exc) from None
    batch = await service.create_batch(
        db,
        plans,
        repetitions=body.repetitions,
        concurrency=body.concurrency,
        label=body.label,
        created_by=principal.user.id,
    )
    runs.launch(batch)
    return BatchDetailOut.of(batch)


@router.get("", response_model=RunPage)
async def list_runs(
    db: Db,
    run_status: Annotated[RunStatus | None, Query(alias="status")] = None,
    scenario_id: Annotated[uuid.UUID | None, Query(alias="scenarioId")] = None,
    batch_id: Annotated[uuid.UUID | None, Query(alias="batchId")] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> RunPage:
    items, total = await service.list_runs(
        db,
        status=run_status,
        scenario_id=scenario_id,
        batch_id=batch_id,
        limit=limit,
        offset=offset,
    )
    return RunPage(items=[RunOut.of(run) for run in items], total=total)


@router.get("/batches", response_model=BatchPage)
async def list_batches(db: Db, limit: Limit = 50, offset: Offset = 0) -> BatchPage:
    items, total = await service.list_batches(db, limit=limit, offset=offset)
    return BatchPage(items=[BatchOut(**BatchOut.fields_of(batch)) for batch in items], total=total)


@router.get("/batches/{batch_id}", response_model=BatchDetailOut)
async def get_batch(batch_id: uuid.UUID, db: Db) -> BatchDetailOut:
    try:
        return BatchDetailOut.of(await service.get_batch(db, batch_id, with_runs=True))
    except BatchNotFound:
        raise _not_found("Batch") from None


@router.post(
    "/batches/{batch_id}/cancel",
    response_model=BatchDetailOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def cancel_batch(batch_id: uuid.UUID, db: Db, runs: Manager) -> BatchDetailOut:
    """Cancel every unfinished run of the batch; 409 when the batch is already over."""
    try:
        await service.get_batch(db, batch_id)
    except BatchNotFound:
        raise _not_found("Batch") from None
    if not await service.mark_batch_cancelled(db, batch_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Batch already finished")
    for run_id in await service.active_run_ids(db, batch_id):
        await runs.cancel_run(run_id)
    return BatchDetailOut.of(await service.get_batch(db, batch_id, with_runs=True))


@router.get("/{run_id}", response_model=RunDetailOut)
async def get_run(run_id: uuid.UUID, db: Db, runs: Manager) -> RunDetailOut:
    try:
        run = await service.get_run(db, run_id)
    except RunNotFound:
        raise _not_found("Run") from None
    transcript = None
    if run.finished:
        transcript = read_json(runs.artifacts_dir(run.id) / "transcript.json")
    return RunDetailOut(
        **RunOut.fields_of(run),
        summary=camelize(run.summary),
        transcript=camelize(transcript) if isinstance(transcript, list) else None,
        snapshot=camelize(run.snapshot),
    )


@router.post("/{run_id}/cancel", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
async def cancel_run(run_id: uuid.UUID, db: Db, runs: Manager) -> RunOut:
    """Ask the run to stop; it becomes `cancelled` once its session is closed. 409 if over."""
    try:
        run = await service.get_run(db, run_id)
    except RunNotFound:
        raise _not_found("Run") from None
    if run.finished or not await runs.cancel_run(run):
        raise HTTPException(status.HTTP_409_CONFLICT, "Run already finished")
    after = await service.get_run(db, run_id)
    if after.finished and after.status not in CANCEL_STATUSES:  # it ended on its own meanwhile
        raise HTTPException(status.HTTP_409_CONFLICT, "Run already finished")
    return RunOut.of(after)


@router.get(
    "/{run_id}/audio/{channel}",
    response_class=FileResponse,
    responses={200: {"content": {"audio/wav": {}}}},
)
async def get_audio(
    run_id: uuid.UUID, channel: Literal["agent", "caller"], db: Db, runs: Manager
) -> FileResponse:
    """One side of the conversation as WAV (PCM16 24 kHz mono), once it has been written."""
    try:
        await service.get_run(db, run_id)
    except RunNotFound:
        raise _not_found("Run") from None
    path = runs.artifacts_dir(run_id) / f"{channel}.wav"
    if not path.is_file():  # noqa: ASYNC240 - one stat call
        raise _not_found("Audio")
    return FileResponse(path, media_type="audio/wav")
