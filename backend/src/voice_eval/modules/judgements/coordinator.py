"""Judgement coordinator: judges finished runs as asyncio tasks inside the backend process.

For each run it gathers the evidence — `transcript.json` and `summary.json` from the run's
artifacts, plus the agent's Langfuse observations for the run's threadId (the Langfuse session
id) — then asks the judge through the run's evaluator connection and stores the result.

Langfuse ingestion is asynchronous: the agent uses the Langfuse SDK 4.5.0, whose data can take
up to ~15 minutes to show up in the v2 observations API. So the traces are polled every
`POLL_INTERVAL_S` until `STABLE_POLLS` polls in a row report the same non-zero observation
count, for at most `TRACE_WAIT_AFTER_END` after the run ended (a re-judge long after
the run fetches once). Without traces the judge still runs, told why they are missing.

Model calls and trace fetches share `MAX_CONCURRENCY` slots; waiting between polls takes none.
Stopping the process cancels the tasks and leaves their judgements unfinished; the next start
(`recover`) judges them again. `sleep`, `now`, `build_judge` and `build_trace_reader` are
attributes, so tests replace them and never wait or contact a provider.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from voice_eval.judge.domain import JudgeError
from voice_eval.judge.service import judge_run
from voice_eval.modules.agents.models import AgentRecord
from voice_eval.modules.connections.domain import CHAT_MODEL, UnsupportedConnection
from voice_eval.modules.connections.runtime import build_judge, build_trace_reader
from voice_eval.modules.judgements import service
from voice_eval.modules.judgements.domain import (
    Judgement,
    JudgementFailed,
    JudgementInProgress,
)
from voice_eval.modules.runs import service as runs
from voice_eval.modules.runs.domain import Run, RunNotFound
from voice_eval.modules.runs.manager import is_judgeable, read_json
from voice_eval.platform.secrets import SecretBox
from voice_eval.ports.judge import RunJudgeModel
from voice_eval.providers.langfuse_traces import TraceFetchError, digest_observations

log = logging.getLogger(__name__)

MAX_CONCURRENCY = 3
POLL_INTERVAL_S = 30.0
STABLE_POLLS = 2
TRACE_WAIT_AFTER_END = timedelta(minutes=20)
TRACE_WINDOW_BEFORE = timedelta(minutes=5)  # observations may start just before the run
TRACE_WINDOW_AFTER = timedelta(minutes=30)
SHUTDOWN_TIMEOUT_S = 10
TRACES_FILE = "langfuse.json"
# At startup, finished runs left without a judgement (a crash right after they ended) are
# judged too, but only recent ones: an old database must not trigger a flood of paid calls.
RECONCILE_WINDOW = timedelta(days=7)

NO_CONNECTION_NOTE = "This agent has no Langfuse connection."
CONNECTION_UNUSABLE_NOTE = (
    "Langfuse traces could not be read: the Langfuse connection could not be used ({detail})."
)
FETCH_FAILED_NOTE = "Langfuse traces could not be read: {error}"


class TraceReader(Protocol):
    async def fetch_session(
        self, session_id: str, *, start: datetime, end: datetime
    ) -> list[dict[str, Any]]: ...


JudgeFactory = Callable[[AsyncSession, uuid.UUID], Awaitable[RunJudgeModel]]
TraceReaderFactory = Callable[[AsyncSession, uuid.UUID], Awaitable[TraceReader]]
Sleep = Callable[[float], Awaitable[None]]
Clock = Callable[[], datetime]


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _detail(exc: Exception) -> str:
    return str(exc) if isinstance(exc, UnsupportedConnection) else type(exc).__name__


def _uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


class JudgementCoordinator:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        *,
        secret_box: SecretBox,
        allow_local_http: bool = False,
        allow_private: bool = False,
    ) -> None:
        self.sessionmaker = sessionmaker
        self.secret_box = secret_box
        self.allow_local_http = allow_local_http
        self.allow_private = allow_private
        self.sleep: Sleep = asyncio.sleep
        self.now: Clock = _utc_now
        self.build_judge: JudgeFactory = self._build_judge
        self.build_trace_reader: TraceReaderFactory = self._build_trace_reader
        self._slots = asyncio.Semaphore(MAX_CONCURRENCY)
        self._tasks: dict[uuid.UUID, asyncio.Task[None]] = {}
        self._stopping = False

    # --- lifecycle ------------------------------------------------------------------------

    async def schedule(self, run_id: uuid.UUID) -> None:
        """Judge a run that just finished (nothing happens while it is already being judged)."""
        try:
            await self.rejudge(run_id)
        except JudgementInProgress:
            log.info("run %s is already being judged", run_id)

    async def rejudge(self, run_id: uuid.UUID) -> Judgement:
        """Reset the run's judgement to `pending` (next attempt) and judge it again.

        Raises `JudgementInProgress` while the current judgement is still active.
        """
        async with self.sessionmaker() as db:
            judgement = await service.start(db, run_id)
        if judgement is None:
            raise JudgementInProgress(str(run_id))
        self._spawn(run_id, judgement.attempt)
        return judgement

    async def recover(self) -> None:
        """At startup: judge again every judgement a previous process left unfinished, then
        judge the judgeable runs that ended within `RECONCILE_WINDOW` without ever getting a
        judgement (the process stopped between recording their end and scheduling them)."""
        try:
            async with self.sessionmaker() as db:
                unfinished = await service.active_judgements(db)
        except Exception as exc:  # report, never leak connection details
            log.warning("could not resume unfinished judgements (%s)", type(exc).__name__)
        else:
            for run_id, attempt in unfinished:
                self._spawn(run_id, attempt)
            if unfinished:
                log.warning("resumed %d unfinished judgement(s)", len(unfinished))
        await self._reconcile()

    async def _reconcile(self) -> None:
        """Each judgement is spawned right after it is committed, and one run's error skips
        only that run (it stays unjudged for the next start), never the ones already started."""
        started = 0
        try:
            async with self.sessionmaker() as db:
                candidates = await service.unjudged_finished_runs(
                    db, ended_since=self.now() - RECONCILE_WINDOW
                )
                for run_id, status, summary in candidates:
                    if not is_judgeable(status, summary):
                        continue
                    try:
                        judgement = await service.start_missing(db, run_id)
                    except Exception as exc:
                        await db.rollback()
                        log.warning(
                            "could not judge run %s left unjudged (%s)", run_id, type(exc).__name__
                        )
                        continue
                    if judgement is not None:
                        self._spawn(judgement.run_id, judgement.attempt)
                        started += 1
        except Exception as exc:
            log.warning("could not judge the runs left unjudged (%s)", type(exc).__name__)
        if started:
            log.warning("judging %d finished run(s) left without a judgement", started)

    async def shutdown(self) -> None:
        """Cancel every judging task; their judgements stay unfinished for the next start."""
        self._stopping = True
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            _, pending = await asyncio.wait(tasks, timeout=SHUTDOWN_TIMEOUT_S)
            if pending:
                log.warning("%d judgement(s) did not stop in time", len(pending))

    def is_active(self, run_id: uuid.UUID) -> bool:
        return run_id in self._tasks

    def _spawn(self, run_id: uuid.UUID, attempt: int) -> None:
        if self._stopping:
            return  # left `pending`: the next start judges it
        previous = self._tasks.get(run_id)
        if previous is not None:
            previous.cancel()  # superseded: its writes no longer match the attempt anyway
        task = asyncio.create_task(self._execute(run_id, attempt), name=f"judge-{run_id}")
        self._tasks[run_id] = task
        task.add_done_callback(lambda done: self._forget(run_id, done))

    def _forget(self, run_id: uuid.UUID, task: asyncio.Task[None]) -> None:
        if self._tasks.get(run_id) is task:
            del self._tasks[run_id]

    # --- one judgement --------------------------------------------------------------------

    async def _execute(self, run_id: uuid.UUID, attempt: int) -> None:
        try:
            await self._judge(run_id, attempt)
        except asyncio.CancelledError:
            raise  # stays unfinished; `recover` resumes it
        except JudgementFailed as exc:
            await self._fail(run_id, attempt, str(exc))
        except Exception as exc:
            log.exception("judgement of run %s failed", run_id)
            await self._fail(run_id, attempt, f"internal error ({type(exc).__name__})")

    async def _fail(self, run_id: uuid.UUID, attempt: int, message: str) -> None:
        try:
            async with self.sessionmaker() as db:
                await service.mark_failed(db, run_id, attempt, message)
        except Exception:
            log.exception("could not record the failed judgement of run %s", run_id)

    async def _judge(self, run_id: uuid.UUID, attempt: int) -> None:
        async with self.sessionmaker() as db:
            try:
                run = await runs.get_run(db, run_id)
            except RunNotFound:
                return  # deleted meanwhile, with its judgement
            connection_id = await self._langfuse_connection(db, run)
        artifacts = Path(run.artifacts_dir) if run.artifacts_dir else None
        transcript = read_json(artifacts / "transcript.json") if artifacts else None
        summary = read_json(artifacts / "summary.json") if artifacts else None
        if not isinstance(summary, dict):
            summary = run.summary or {}

        digest, note = None, NO_CONNECTION_NOTE
        if connection_id is not None:
            async with self.sessionmaker() as db:
                if not await service.mark_collecting(db, run_id, attempt):
                    return  # superseded by a re-judge
            observations, note = await self._collect_traces(run, connection_id)
            if observations:
                if artifacts is not None:
                    await self._save_observations(artifacts, observations)
                digest = digest_observations(observations, origin=run.started_at)

        stats = digest.to_prompt_dict()["stats"] if digest is not None else None
        async with self.sessionmaker() as db:
            if not await service.mark_judging(
                db, run_id, attempt, trace_stats=stats, trace_note=note
            ):
                return

        evaluator = run.snapshot["connections"]["evaluator"]
        model_name = evaluator.get("chat_model") or CHAT_MODEL
        async with self.sessionmaker() as db:
            try:
                model = await self.build_judge(db, uuid.UUID(evaluator["id"]))
            except Exception as exc:
                raise JudgementFailed(
                    f"the evaluator connection could not be used ({_detail(exc)})"
                ) from None
        try:
            async with self._slots:
                result = await judge_run(
                    model,
                    snapshot=run.snapshot,
                    transcript=transcript if isinstance(transcript, list) else [],
                    summary=summary,
                    trace_digest=digest,
                    trace_note=note,
                    run_id=str(run.id),
                    thread_id=run.thread_id,
                    model_name=model_name,
                )
        except JudgeError as exc:
            raise JudgementFailed(str(exc)) from None
        async with self.sessionmaker() as db:
            await service.mark_completed(
                db,
                run_id,
                attempt,
                result=result.model_dump(mode="json", by_alias=True),
                model=model_name,
            )

    async def _langfuse_connection(self, db: AsyncSession, run: Run) -> uuid.UUID | None:
        """From the snapshot; runs launched before it kept the id fall back to the agent row."""
        agent = run.snapshot.get("agent") or {}
        if "langfuse_connection_id" in agent:
            return _uuid(agent["langfuse_connection_id"])
        if run.agent_id is None:
            return None
        record = await db.get(AgentRecord, run.agent_id)
        return record.langfuse_connection_id if record is not None else None

    async def _collect_traces(
        self, run: Run, connection_id: uuid.UUID
    ) -> tuple[list[dict[str, Any]], str | None]:
        """The run's observations (possibly none) and a note when they are missing."""
        async with self.sessionmaker() as db:
            try:
                reader = await self.build_trace_reader(db, connection_id)
            except Exception as exc:
                return [], CONNECTION_UNUSABLE_NOTE.format(detail=_detail(exc))
        started = run.started_at or run.created_at
        ended = run.ended_at or self.now()
        deadline = ended + TRACE_WAIT_AFTER_END
        start, end = started - TRACE_WINDOW_BEFORE, ended + TRACE_WINDOW_AFTER

        observations: list[dict[str, Any]] = []
        error: str | None = None
        previous, stable = 0, 0
        while True:
            try:
                async with self._slots:
                    observations = await reader.fetch_session(run.thread_id, start=start, end=end)
                error = None
            except TraceFetchError as exc:
                error = str(exc)  # retried on the next poll; kept only if it persists
            except Exception as exc:  # a reader bug must not fail the judgement; never its text
                log.warning("langfuse fetch failed unexpectedly (%s)", type(exc).__name__)
                error = f"Langfuse request failed (unexpected error: {type(exc).__name__})"
            if error is None and observations:
                stable = stable + 1 if len(observations) == previous else 1
                previous = len(observations)
                if stable >= STABLE_POLLS:
                    break
            if self.now() + timedelta(seconds=POLL_INTERVAL_S) > deadline:
                break
            await self.sleep(POLL_INTERVAL_S)

        if observations:
            return observations, None
        if error is not None:
            return [], FETCH_FAILED_NOTE.format(error=error)
        minutes = max(0, round((self.now() - ended).total_seconds() / 60))
        return [], (f"No Langfuse traces found for session {run.thread_id} within {minutes} min.")

    async def _save_observations(self, artifacts: Path, observations: list[dict]) -> None:
        def write() -> None:
            artifacts.mkdir(parents=True, exist_ok=True)
            (artifacts / TRACES_FILE).write_text(json.dumps(observations, ensure_ascii=False))

        try:
            await asyncio.to_thread(write)
        except OSError as exc:
            log.warning("could not save the Langfuse observations (%s)", type(exc).__name__)

    # --- providers ------------------------------------------------------------------------

    async def _build_judge(self, db: AsyncSession, connection_id: uuid.UUID) -> RunJudgeModel:
        return await build_judge(
            db, connection_id, secret_box=self.secret_box, allow_local_http=self.allow_local_http
        )

    async def _build_trace_reader(self, db: AsyncSession, connection_id: uuid.UUID) -> TraceReader:
        return await build_trace_reader(
            db,
            connection_id,
            secret_box=self.secret_box,
            allow_local_http=self.allow_local_http,
            allow_private=self.allow_private,
        )
