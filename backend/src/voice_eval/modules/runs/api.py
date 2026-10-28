"""HTTP API of the runs module: `/api/runs/*` (behind authentication).

Launching validates that every scenario can run (a voice connection and an evaluator model),
creates the batch with one queued run per scenario and repetition, and hands it to the task
manager (`app.state.runs`). Each run carries its judgement's status, score and must flag (the
judgement itself is served by `modules.judgements.api`). Summaries, transcripts and snapshots
are returned with camelCase keys.
"""

import asyncio
import uuid
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.connections.langfuse_links import (
    LangfuseLinks,
    default_links,
    session_url,
    thread_traces_url,
    trace_url,
)
from voice_eval.modules.pricing import service as pricing
from voice_eval.modules.pricing.domain import ModelPrice, run_cost
from voice_eval.modules.runs import service
from voice_eval.modules.runs.conversation import conversation_file
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
from voice_eval.modules.runs.levels import DEFAULT_BINS, MAX_BINS, MIN_BINS, RunLevels, build_levels
from voice_eval.modules.runs.manager import RunManager, read_json
from voice_eval.modules.runs.trace import build_trace
from voice_eval.modules.users.deps import Principal, current_principal
from voice_eval.platform.db import get_db_session
from voice_eval.platform.secrets import SecretBox, app_secret_box
from voice_eval.platform.settings import Settings, app_settings

CANCEL_STATUSES = frozenset({RunStatus.CANCELLED, RunStatus.INTERRUPTED})
TRACES_FILE = "langfuse.json"  # written by the judge (`modules.judgements.coordinator`)
NO_TRACE_NOTE = (
    "No Langfuse trace was saved for this run: the agent has no Langfuse connection, or no "
    "observations were found for its session."
)
LEVELS_CACHE_SIZE = 64
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


def langfuse_links() -> LangfuseLinks:
    """FastAPI dependency: the process-wide Langfuse project cache (overridden in tests)."""
    return default_links


Links = Annotated[LangfuseLinks, Depends(langfuse_links)]
Box = Annotated[SecretBox, Depends(app_secret_box)]
AppSettings = Annotated[Settings, Depends(app_settings)]


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


class CostLineOut(CamelModel):
    part: Literal["caller", "judge"]
    model: str
    usd: float | None  # None: some of its tokens have no price


class RunCostOut(CamelModel):
    """The evaluator's approximate cost of a run, in USD, from the price table (`/api/pricing`):
    its caller (realtime evaluator, or chat + TTS, or chat for text runs) and its judge (every
    sample of every judgement attempt). `complete` is false when some usage has no price or
    could not be metered (TTS audio); `notes` say which."""

    caller_usd: float | None  # None: no caller usage recorded
    judge_usd: float | None  # None: no judge usage recorded (yet)
    total_usd: float
    complete: bool
    notes: list[str]
    breakdown: list[CostLineOut]


def _cost(run: Run, prices: list[ModelPrice] | None) -> RunCostOut | None:
    if prices is None:
        return None
    cost = run_cost(run.caller_usage, run.judge_usage, prices)
    if cost is None:
        return None
    return RunCostOut(
        caller_usd=cost.caller_usd,
        judge_usd=cost.judge_usd,
        total_usd=cost.total_usd,
        complete=cost.complete,
        notes=cost.notes,
        breakdown=[CostLineOut(part=c.part, model=c.model, usd=c.usd) for c in cost.breakdown],
    )


def _snapshot_agent_kind(snapshot: Any) -> Any:
    agent = snapshot.get("agent") if isinstance(snapshot, dict) else None
    return agent.get("kind") if isinstance(agent, dict) else None


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
    must_failed: bool | None  # whether any must criterion failed, once completed
    persona: str | None  # the scenario persona's name, from the snapshot
    caller_turns: int | None  # from the summary, once the run finished
    agent_turns: int | None
    latency_p50_ms: int | None  # median response latency of the summary
    agent_kind: Literal["voice", "text"]  # from the snapshot; runs of older snapshots are voice
    cost: RunCostOut | None = None  # None: no usage recorded (runs before usage capture)

    @classmethod
    def fields_of(cls, run: Run, prices: list[ModelPrice] | None = None) -> dict[str, Any]:
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
            "must_failed": run.must_failed,
            "persona": run.persona,
            "caller_turns": run.caller_turns,
            "agent_turns": run.agent_turns,
            "latency_p50_ms": run.latency_p50_ms,
            "agent_kind": "text" if _snapshot_agent_kind(run.snapshot) == "text" else "voice",
            "cost": _cost(run, prices),
        }

    @classmethod
    def of(cls, run: Run, prices: list[ModelPrice] | None = None) -> "RunOut":
        return cls(**cls.fields_of(run, prices))


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
    def of(cls, batch: Batch, prices: list[ModelPrice] | None = None) -> "BatchDetailOut":
        runs = [RunOut.of(run, prices) for run in batch.runs or []]
        return cls(**cls.fields_of(batch), runs=runs)


class BatchPage(CamelModel):
    items: list[BatchOut]
    total: int


class TraceObservationOut(CamelModel):
    id: str | None
    trace_id: str | None
    parent_id: str | None
    type: str  # "llm", "tool", "span", "event", or another Langfuse type in lowercase
    name: str | None
    start_ms: int | None  # from the run start
    duration_ms: int | None
    model: str | None
    tokens: int | None
    cost_usd: float | None
    level: str  # DEFAULT, DEBUG, WARNING or ERROR
    status_message: str | None
    depth: int  # nesting under the parent observation (0: a root)


class LangfuseLinksOut(CamelModel):
    thread_traces_url: str | None  # every trace (turn) of the run; None when the project is unknown
    trace_url: str | None  # the run's first trace; None without saved observations


class TraceOut(CamelModel):
    available: bool
    note: str | None
    stats: dict[str, Any] | None  # the judge digest's stats (camelCase)
    observations: list[TraceObservationOut]
    langfuse: LangfuseLinksOut | None = None  # None when the agent has no Langfuse connection


class LevelTurnOut(CamelModel):
    role: Literal["agent", "caller"]
    start_ms: int
    end_ms: int
    ref: str  # A<n> / C<n>, as the judge cites turns


class LevelsOut(CamelModel):
    duration_ms: int
    agent: list[float]  # RMS 0..1 per bin, one scale for both sides
    caller: list[float]
    turns: list[LevelTurnOut]


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


async def _launch(
    db: AsyncSession, runs: RunManager, body: LaunchIn, principal: Principal
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


@router.post("", response_model=BatchDetailOut, status_code=status.HTTP_201_CREATED)
async def launch(
    body: LaunchIn, principal: CurrentPrincipal, db: Db, runs: Manager
) -> BatchDetailOut:
    return await _launch(db, runs, body, principal)


@router.get("", response_model=RunPage)
async def list_runs(
    db: Db,
    run_status: Annotated[RunStatus | None, Query(alias="status")] = None,
    scenario_id: Annotated[uuid.UUID | None, Query(alias="scenarioId")] = None,
    batch_id: Annotated[uuid.UUID | None, Query(alias="batchId")] = None,
    order: Annotated[service.RunOrder, Query()] = "newest",
    limit: Limit = 50,
    offset: Offset = 0,
) -> RunPage:
    """A page of runs, filtered by status, scenario and batch.

    `order` is `newest` (default: newest first) or `oldest` (oldest first); a batch's runs stay in
    launch order either way. Any other value is a 422.
    """
    items, total = await service.list_runs(
        db,
        status=run_status,
        scenario_id=scenario_id,
        batch_id=batch_id,
        order=order,
        limit=limit,
        offset=offset,
    )
    prices = await pricing.list_prices(db)
    return RunPage(items=[RunOut.of(run, prices) for run in items], total=total)


@router.get("/batches", response_model=BatchPage)
async def list_batches(db: Db, limit: Limit = 50, offset: Offset = 0) -> BatchPage:
    items, total = await service.list_batches(db, limit=limit, offset=offset)
    return BatchPage(items=[BatchOut(**BatchOut.fields_of(batch)) for batch in items], total=total)


@router.get("/batches/{batch_id}", response_model=BatchDetailOut)
async def get_batch(batch_id: uuid.UUID, db: Db) -> BatchDetailOut:
    try:
        batch = await service.get_batch(db, batch_id, with_runs=True)
    except BatchNotFound:
        raise _not_found("Batch") from None
    return BatchDetailOut.of(batch, await pricing.list_prices(db))


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
    batch = await service.get_batch(db, batch_id, with_runs=True)
    return BatchDetailOut.of(batch, await pricing.list_prices(db))


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
        **RunOut.fields_of(run, await pricing.list_prices(db)),
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
    return RunOut.of(after, await pricing.list_prices(db))


# Declared before `/{run_id}/audio/{channel}`, which would answer 422 for this channel.
@router.get(
    "/{run_id}/audio/conversation",
    response_class=FileResponse,
    responses={200: {"content": {"audio/wav": {}}}},
)
async def get_conversation_audio(
    run_id: uuid.UUID, db: Db, runs: Manager, download: bool = False
) -> FileResponse:
    """The whole conversation as one WAV (PCM16 24 kHz mono): agent and caller mixed on the run
    timeline, with the pauses, overlaps and barge-in cuts as they happened. Mixed once, then
    served as a file (byte ranges, so players can seek). `download=1` names the file as an
    attachment; otherwise it plays inline. 409 while the run is in progress."""
    try:
        run = await service.get_run(db, run_id)
    except RunNotFound:
        raise _not_found("Run") from None
    if not run.finished:
        raise HTTPException(status.HTTP_409_CONFLICT, "Run still in progress")
    path = await asyncio.to_thread(conversation_file, _artifacts(run, runs), run.summary)
    if path is None:
        raise _not_found("Audio")
    name = f"run-{str(run.id)[:8]}-conversation.wav"
    disposition = f'attachment; filename="{name}"' if download else "inline"
    return FileResponse(path, media_type="audio/wav", headers={"Content-Disposition": disposition})


@router.get(
    "/{run_id}/audio/{channel}",
    response_class=FileResponse,
    responses={200: {"content": {"audio/wav": {}}}},
)
async def get_audio(
    run_id: uuid.UUID, channel: Literal["agent", "caller"], db: Db, runs: Manager
) -> FileResponse:
    """One side of the conversation as WAV (PCM16 24 kHz mono), once it has been written (404
    for a text run: it has no audio)."""
    try:
        await service.get_run(db, run_id)
    except RunNotFound:
        raise _not_found("Run") from None
    path = runs.artifacts_dir(run_id) / f"{channel}.wav"
    if not path.is_file():  # noqa: ASYNC240 - one stat call
        raise _not_found("Audio")
    return FileResponse(path, media_type="audio/wav")


@router.post("/{run_id}/rerun", response_model=BatchDetailOut, status_code=status.HTTP_201_CREATED)
async def rerun(
    run_id: uuid.UUID, principal: CurrentPrincipal, db: Db, runs: Manager
) -> BatchDetailOut:
    """Launch the run's scenario again (as it is now): one run, in a new batch labelled
    "Re-run of <first 8 characters of the run id>". Paid, like `POST /api/runs`, with the same
    422 when the scenario cannot run; 409 when the scenario was deleted."""
    try:
        run = await service.get_run(db, run_id)
    except RunNotFound:
        raise _not_found("Run") from None
    if run.scenario_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The scenario of this run was deleted")
    body = LaunchIn(scenario_ids=[run.scenario_id], label=f"Re-run of {str(run.id)[:8]}")
    return await _launch(db, runs, body, principal)


def _artifacts(run: Run, runs: RunManager) -> Path:
    return Path(run.artifacts_dir) if run.artifacts_dir else runs.artifacts_dir(run.id)


@router.get("/{run_id}/trace", response_model=TraceOut)
async def get_trace(
    run_id: uuid.UUID, db: Db, runs: Manager, links: Links, box: Box, settings: AppSettings
) -> dict[str, Any]:
    """The agent's Langfuse observations for the run, as a waterfall (offsets from the run
    start). `available` is false, with a `note`, when none were saved (no Langfuse connection,
    nothing found, the run still in progress or not judged yet). `langfuse` links the run in
    Langfuse's UI: `threadTracesUrl` (every turn of the run) when Langfuse told its project id, and
    `traceUrl` (the first trace) when observations were saved; null without a Langfuse
    connection or while the run is in progress."""
    try:
        run = await service.get_run(db, run_id)
    except RunNotFound:
        raise _not_found("Run") from None
    if not run.finished:
        return build_trace(None, origin=None, note="The run is still in progress.")
    path = _artifacts(run, runs) / TRACES_FILE
    observations = await asyncio.to_thread(read_json, path)
    note = None
    usable = isinstance(observations, list) and any(isinstance(row, dict) for row in observations)
    if not usable:
        note = await service.judgement_trace_note(db, run_id) or NO_TRACE_NOTE
    trace = build_trace(observations, origin=run.started_at, note=note)
    trace["langfuse"] = await _langfuse_links(db, run, trace, links, box, settings)
    return trace


def traces_link(host: str, project_id: str | None, run: Run) -> str | None:
    """Every trace of the run. Vivi agents tag each turn's trace with `metadata.thread_id`; a
    relay agent is found by the standard Langfuse session of its own conversation."""
    if not project_id or not run.thread_id:
        return None
    if run.relay:
        return session_url(host, project_id, run.langfuse_session_id)
    return thread_traces_url(host, project_id, run.thread_id)


async def _langfuse_links(
    db: AsyncSession,
    run: Run,
    trace: dict[str, Any],
    links: LangfuseLinks,
    box: SecretBox,
    settings: Settings,
) -> dict[str, str | None] | None:
    connection_id = await service.langfuse_connection_id(db, run)
    if connection_id is None:
        return None
    development = settings.environment == "development"
    project = await links.resolve(
        db, connection_id, secret_box=box, allow_local_http=development, allow_private=development
    )
    if project is None:
        return None
    trace_id = next((row["traceId"] for row in trace["observations"] if row["traceId"]), None)
    return {
        "thread_traces_url": traces_link(project.host, project.project_id, run),
        "trace_url": trace_url(project.host, trace_id) if trace_id else None,
    }


_levels_cache: OrderedDict[tuple[uuid.UUID, int], RunLevels] = OrderedDict()


@router.get("/{run_id}/levels", response_model=LevelsOut)
async def get_levels(
    run_id: uuid.UUID,
    db: Db,
    runs: Manager,
    bins: Annotated[int, Query(ge=MIN_BINS, le=MAX_BINS)] = DEFAULT_BINS,
) -> LevelsOut:
    """Audio levels of both sides on the run timeline (RMS 0..1 per bin), and the turns.
    409 while the run is in progress; 404 for a text run (it has no audio)."""
    try:
        run = await service.get_run(db, run_id)
    except RunNotFound:
        raise _not_found("Run") from None
    if run.snapshot.get("agent", {}).get("kind") == "text":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "A text run has no audio levels")
    if not run.finished:
        raise HTTPException(status.HTTP_409_CONFLICT, "Run still in progress")
    key = (run.id, bins)
    levels = _levels_cache.get(key)
    if levels is None:  # a finished run's artifacts never change
        levels = await asyncio.to_thread(
            build_levels, _artifacts(run, runs), bins=bins, summary=run.summary
        )
        _levels_cache[key] = levels
        while len(_levels_cache) > LEVELS_CACHE_SIZE:
            _levels_cache.popitem(last=False)
    else:
        _levels_cache.move_to_end(key)
    return LevelsOut(
        duration_ms=levels.duration_ms,
        agent=levels.agent,
        caller=levels.caller,
        turns=[LevelTurnOut(**turn) for turn in levels.turns],
    )
