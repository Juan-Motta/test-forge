"""Judgement coordinator: judges finished runs as asyncio tasks inside the backend process.

For each run it gathers the evidence — `transcript.json` and `summary.json` from the run's
artifacts, plus the agent's Langfuse observations for the run's threadId (the Langfuse session
id) — then asks the judge through the run's evaluator connection and stores the result.

Langfuse ingestion is asynchronous: the agent uses the Langfuse SDK 4.5.0, whose data can take
up to ~15 minutes to show up in the v2 observations API. So the traces are polled every
`POLL_INTERVAL_S` until `STABLE_POLLS` polls in a row report the same non-zero observation
count, for at most `TRACE_WAIT_AFTER_END` after the run ended (a re-judge long after
the run fetches once). Without traces the judge still runs, told why they are missing.

Once a judgement is stored, a separate task makes its translated versions (`judge.translation`:
one structured call per language with a fresh judge model of the same evaluator connection);
its usage is added to the judgement's, and a failed translation never fails the judgement.
Old judgements are translated on demand (`translate`).

Model calls and trace fetches share `MAX_CONCURRENCY` slots; waiting between polls takes none.
Stopping the process cancels the tasks and leaves their judgements unfinished; the next start
(`recover`) judges them again and resumes the translations left pending. `sleep`, `now`,
`build_judge` and `build_trace_reader` are attributes, so tests replace them and never wait or
contact a provider.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from voice_eval.judge.domain import JudgeError, JudgeResult
from voice_eval.judge.service import judge_run
from voice_eval.judge.translation import LANGUAGES, TranslationError, translate_result
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
from voice_eval.ports.usage import collect_usage, usage_since
from voice_eval.providers.langfuse_traces import (
    TraceDigest,
    TraceFetchError,
    digest_observations,
)

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


@dataclass(frozen=True)
class JudgeInputs:
    """Everything `judge_run` needs for one stored run, besides the model."""

    run: Run
    transcript: list[dict[str, Any]]
    summary: dict[str, Any]
    trace_digest: TraceDigest | None
    trace_note: str | None
    model_name: str

    @property
    def trace_stats(self) -> dict[str, Any] | None:
        return (
            self.trace_digest.to_prompt_dict()["stats"] if self.trace_digest is not None else None
        )


def _read_evidence(run: Run) -> tuple[Path | None, Any, dict[str, Any]]:
    """The run's artifacts dir, its transcript (as read) and its summary (the stored one when
    `summary.json` is missing or invalid)."""
    artifacts = Path(run.artifacts_dir) if run.artifacts_dir else None
    transcript = read_json(artifacts / "transcript.json") if artifacts else None
    summary = read_json(artifacts / "summary.json") if artifacts else None
    if not isinstance(summary, dict):
        summary = run.summary or {}
    return artifacts, transcript, summary


def _judge_inputs(
    run: Run,
    transcript: Any,
    summary: dict[str, Any],
    observations: list[dict[str, Any]],
    note: str | None,
) -> JudgeInputs:
    evaluator = run.snapshot["connections"]["evaluator"]
    return JudgeInputs(
        run=run,
        transcript=transcript if isinstance(transcript, list) else [],
        summary=summary,
        trace_digest=digest_observations(observations, origin=run.started_at)
        if observations
        else None,
        trace_note=note,
        model_name=evaluator.get("chat_model") or CHAT_MODEL,
    )


async def judge_inputs(model: RunJudgeModel, inputs: JudgeInputs) -> JudgeResult:
    """One judgement of prepared inputs (stores nothing). Raises `JudgeError`."""
    return await judge_run(
        model,
        snapshot=inputs.run.snapshot,
        transcript=inputs.transcript,
        summary=inputs.summary,
        trace_digest=inputs.trace_digest,
        trace_note=inputs.trace_note,
        run_id=str(inputs.run.id),
        thread_id=inputs.run.thread_id,
        model_name=inputs.model_name,
    )


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
        self._translating: dict[tuple[uuid.UUID, str], asyncio.Task[None]] = {}
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
        try:
            async with self.sessionmaker() as db:
                pending = await service.pending_translations(db)
        except Exception as exc:
            log.warning("could not resume pending translations (%s)", type(exc).__name__)
        else:
            for run_id, attempt, language in pending:
                self._spawn_translation(run_id, attempt, language)
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
        tasks = [*self._tasks.values(), *self._translating.values()]
        for task in tasks:
            task.cancel()
        if tasks:
            _, pending = await asyncio.wait(tasks, timeout=SHUTDOWN_TIMEOUT_S)
            if pending:
                log.warning("%d judgement(s) did not stop in time", len(pending))

    def is_active(self, run_id: uuid.UUID) -> bool:
        return run_id in self._tasks

    def is_translating(self, run_id: uuid.UUID, language: str | None = None) -> bool:
        return any(
            key[0] == run_id and (language is None or key[1] == language)
            for key in self._translating
        )

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

    def _spawn_translation(self, run_id: uuid.UUID, attempt: int, language: str) -> None:
        if self._stopping:
            return  # left `pending`: the next start makes it
        key = (run_id, language)
        previous = self._translating.get(key)
        if previous is not None:
            previous.cancel()
        task = asyncio.create_task(
            self._translate(run_id, attempt, language), name=f"translate-{run_id}-{language}"
        )
        self._translating[key] = task
        task.add_done_callback(lambda done: self._forget_translation(key, done))

    def _forget_translation(self, key: tuple[uuid.UUID, str], task: asyncio.Task[None]) -> None:
        if self._translating.get(key) is task:
            del self._translating[key]

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
        artifacts, transcript, summary = _read_evidence(run)

        observations, note = [], NO_CONNECTION_NOTE
        if connection_id is not None:
            async with self.sessionmaker() as db:
                if not await service.mark_collecting(db, run_id, attempt):
                    return  # superseded by a re-judge
            observations, note = await self._collect_traces(run, connection_id)
            if observations and artifacts is not None:
                await self._save_observations(artifacts, observations)
        inputs = _judge_inputs(run, transcript, summary, observations, note)

        async with self.sessionmaker() as db:
            if not await service.mark_judging(
                db, run_id, attempt, trace_stats=inputs.trace_stats, trace_note=note
            ):
                return

        model = await self.evaluator(run)
        try:
            async with self._slots:
                result = await judge_inputs(model, inputs)
        except JudgeError as exc:
            await self._record_usage(run_id, model)
            raise JudgementFailed(str(exc)) from None
        usage = await self._record_usage(run_id, model)
        result = result.model_copy(update={"usage": usage})
        async with self.sessionmaker() as db:
            completed = await service.mark_completed(
                db,
                run_id,
                attempt,
                result=result.model_dump(mode="json", by_alias=True),
                model=inputs.model_name,
            )
        if completed:
            for language in LANGUAGES:
                self._spawn_translation(run_id, attempt, language)

    async def _record_usage(
        self, run_id: uuid.UUID, model: Any, *, before: dict | None = None
    ) -> dict | None:
        """The usage its model's meter (if it has one) added since `before`, added to the run's
        judge usage.

        A cancelled attempt (shutdown, superseded) records nothing: its usage is lost.
        """
        usage = usage_since(before, collect_usage(model))
        try:
            async with self.sessionmaker() as db:
                await service.add_usage(db, run_id, usage)
        except Exception as exc:  # the judgement stands without its usage
            log.warning(
                "could not record the judge usage of run %s (%s)", run_id, type(exc).__name__
            )
        return usage

    # --- translations ---------------------------------------------------------------------

    async def translate(self, run_id: uuid.UUID, language: str) -> Judgement:
        """Make the completed judgement's `language` version unless it is ready or being made
        (idempotent); the returned judgement shows its status.

        Raises `JudgementInProgress` while judging, `JudgementNotTranslatable` without a
        completed judgement.
        """
        async with self.sessionmaker() as db:
            judgement, started = await service.request_translation(
                db,
                run_id,
                language,
                restart_pending=not self.is_translating(run_id, language),
            )
        if started:
            self._spawn_translation(run_id, judgement.attempt, language)
        return judgement

    async def _translate(self, run_id: uuid.UUID, attempt: int, language: str) -> None:
        try:
            entry = await self._translation(run_id, attempt, language)
        except asyncio.CancelledError:
            raise  # stays pending; `recover` resumes it
        except Exception as exc:
            log.exception("translation of the judgement of run %s failed", run_id)
            entry = {"status": "failed", "error": f"internal error ({type(exc).__name__})"}
        if entry is None:
            return
        try:
            async with self.sessionmaker() as db:
                await service.set_translation(db, run_id, attempt, language, entry)
        except Exception:
            log.exception("could not record the translation of run %s", run_id)

    async def _translation(
        self, run_id: uuid.UUID, attempt: int, language: str
    ) -> dict[str, Any] | None:
        """The translation entry to store, or None when the judgement is gone or superseded."""
        async with self.sessionmaker() as db:
            judgement = await service.get_judgement(db, run_id)
            try:
                run = await runs.get_run(db, run_id)
            except RunNotFound:
                return None
        if judgement is None or judgement.attempt != attempt or not judgement.result:
            return None
        try:
            model = await self.evaluator(run)
        except JudgementFailed as exc:
            return {"status": "failed", "error": f"no model to translate with: {exc}"}
        agent = run.snapshot.get("agent") or {}
        scenario = run.snapshot.get("scenario") or {}
        keep = [agent.get("name"), scenario.get("name"), str(run.id), run.thread_id]
        before = collect_usage(model)
        try:
            async with self._slots:
                fields = await translate_result(
                    model,
                    judgement.result,
                    keep=[str(term) for term in keep if term],
                    language=language,  # type: ignore[arg-type]
                )
        except TranslationError as exc:
            await self._record_usage(run_id, model, before=before)
            return {"status": "failed", "error": str(exc)}
        await self._record_usage(run_id, model, before=before)
        return {"status": "ready", "error": None, "fields": fields}

    # --- judging without storing (voice-eval judge-stability) -----------------------------

    async def prepare(self, run_id: uuid.UUID) -> JudgeInputs:
        """The judge's inputs for a stored run, as `_judge` gathers them, but read-only: the
        traces are fetched once (no polling), nothing is written to the database or the
        artifacts. Raises `RunNotFound`."""
        async with self.sessionmaker() as db:
            run = await runs.get_run(db, run_id)
            connection_id = await self._langfuse_connection(db, run)
        _, transcript, summary = _read_evidence(run)
        observations, note = [], NO_CONNECTION_NOTE
        if connection_id is not None:
            observations, note = await self._collect_traces(run, connection_id, poll=False)
        return _judge_inputs(run, transcript, summary, observations, note)

    async def evaluator(self, run: Run) -> RunJudgeModel:
        """The judge model of the run's evaluator connection; `JudgementFailed` when unusable."""
        evaluator = ((run.snapshot or {}).get("connections") or {}).get("evaluator") or {}
        connection_id = _uuid(evaluator.get("id"))
        if connection_id is None:
            raise JudgementFailed("the run has no evaluator connection")
        async with self.sessionmaker() as db:
            try:
                return await self.build_judge(db, connection_id)
            except Exception as exc:
                raise JudgementFailed(
                    f"the evaluator connection could not be used ({_detail(exc)})"
                ) from None

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
        self, run: Run, connection_id: uuid.UUID, *, poll: bool = True
    ) -> tuple[list[dict[str, Any]], str | None]:
        """The run's observations (possibly none) and a note when they are missing; without
        `poll`, from a single fetch."""
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
            if not poll or self.now() + timedelta(seconds=POLL_INTERVAL_S) > deadline:
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
