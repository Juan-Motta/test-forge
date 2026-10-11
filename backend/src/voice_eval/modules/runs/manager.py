"""Run task manager: drives launched runs as asyncio tasks inside the backend process.

Each run waits for a slot of its batch (the batch's concurrency) and one of the process
(`RUNS_MAX_CONCURRENCY`, shared by every batch), then builds its providers from the connections
as stored right now, opens the agent with the run's own threadId and holds the conversation with
a `SessionRunner` whose artifacts land in `<RUNS_DATA_DIR>/<run id>/`. Status changes are
persisted as they happen, and every event is published to the live hub (`self.hub`, see
`modules.runs.live`). Cancelling a run cancels its task (the runner still closes the
session and writes its artifacts); stopping the process interrupts every unfinished run, and
the next start marks any run a crash left behind as `interrupted`. A run that ends `completed`,
or `failed` after the agent spoke at least once, is handed to the judgement coordinator
(`judgements`, when one is wired) to be scored.

The factories (`build_policy`, `build_synthesizer`) and the whole `drive` step are attributes,
so tests replace them and never contact a provider.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from voice_eval.modules.connections.domain import UnsupportedConnection
from voice_eval.modules.connections.runtime import build_caller_policy, build_synthesizer
from voice_eval.modules.runs import service
from voice_eval.modules.runs.domain import Batch, Run, RunStatus, brief_from_snapshot
from voice_eval.modules.runs.live import LiveHub
from voice_eval.platform.secrets import SecretBox
from voice_eval.ports.policy import CallerPolicy
from voice_eval.ports.tts import SpeechSynthesizer
from voice_eval.runner.events import EventSink, RunEvent
from voice_eval.runner.session import SessionOptions, SessionRunner
from voice_eval.targets.detect import TargetSpec

log = logging.getLogger(__name__)

SHUTDOWN_TIMEOUT_S = 20  # the runner closes its session (5 s) and writes artifacts first


@dataclass(frozen=True)
class RunJob:
    run_id: uuid.UUID
    batch_id: uuid.UUID
    thread_id: str
    snapshot: dict[str, Any]
    out_dir: Path


class JudgementScheduler(Protocol):
    async def schedule(self, run_id: uuid.UUID) -> None: ...


class RunSetupError(Exception):
    """The run could not start (a provider could not be built); the message is safe to store."""


Drive = Callable[[RunJob, EventSink], Awaitable[dict[str, Any]]]
PolicyFactory = Callable[[AsyncSession, uuid.UUID], Awaitable[CallerPolicy]]
SynthesizerFactory = Callable[[AsyncSession, uuid.UUID, str | None], Awaitable[SpeechSynthesizer]]


def read_json(path: Path) -> Any:
    """A JSON artifact, or None when it is missing or unreadable."""
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _provider_error(role: str, exc: Exception) -> RunSetupError:
    detail = str(exc) if isinstance(exc, UnsupportedConnection) else type(exc).__name__
    return RunSetupError(f"the {role} connection could not be used ({detail})")


def publish(action: Callable[..., None], *args: Any) -> None:
    """Call a live-hub method; a failure there is logged (type only) and never stops the run."""
    try:
        action(*args)
    except Exception as exc:
        log.warning("live publish failed (%s)", type(exc).__name__)


class RunEventSink:
    """Publishes a run's events live and persists the status changes they imply."""

    def __init__(self, manager: "RunManager", job: RunJob) -> None:
        self.manager = manager
        self.job = job

    async def emit(self, event: RunEvent) -> None:
        hub = self.manager.hub
        publish(hub.event, self.job.run_id, event)
        if event.type == "protocol_detected":
            async with self.manager.sessionmaker() as db:
                await service.mark_running(db, self.job.run_id)
            publish(hub.status, self.job.run_id, RunStatus.RUNNING.value)


class RunManager:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        *,
        secret_box: SecretBox,
        data_dir: Path,
        max_concurrency: int,
        allow_local_http: bool = False,
        judgements: JudgementScheduler | None = None,
    ) -> None:
        self.sessionmaker = sessionmaker
        self.judgements = judgements
        self.secret_box = secret_box
        self.data_dir = data_dir
        self.allow_local_http = allow_local_http
        self.drive: Drive = self.drive_session
        self.build_policy: PolicyFactory = self._build_policy
        self.build_synthesizer: SynthesizerFactory = self._build_synthesizer
        self.session_overrides: dict[str, Any] = {}  # SessionOptions fields (tests tune timings)
        self.hub = LiveHub()
        self._slots = asyncio.Semaphore(max_concurrency)
        self._batch_slots: dict[uuid.UUID, asyncio.Semaphore] = {}
        self._tasks: dict[uuid.UUID, asyncio.Task[None]] = {}
        self._jobs: dict[uuid.UUID, RunJob] = {}
        self._entered: set[uuid.UUID] = set()
        self._stopping = False

    def resize(self, max_concurrency: int) -> None:
        """Change the process-wide cap (before launching; tests)."""
        self._slots = asyncio.Semaphore(max_concurrency)

    def artifacts_dir(self, run_id: uuid.UUID) -> Path:
        return self.data_dir / str(run_id)

    # --- lifecycle ------------------------------------------------------------------------

    async def recover(self) -> None:
        """At startup: runs left unfinished by a previous process become `interrupted`.

        A database that is not reachable yet does not stop the app from starting (the health
        check reports it); the runs stay as they are until the next start.
        """
        try:
            async with self.sessionmaker() as db:
                count = await service.mark_interrupted(db)
        except Exception as exc:  # report, never leak connection details
            log.warning("could not mark unfinished runs as interrupted (%s)", type(exc).__name__)
            return
        if count:
            log.warning("marked %d unfinished run(s) as interrupted", count)

    async def shutdown(self) -> None:
        """Interrupt every run still queued or running and wait (bounded) for their artifacts."""
        self._stopping = True
        tasks = dict(self._tasks)
        for run_id in tasks:
            await self.cancel_run(run_id)
        if tasks:
            _, pending = await asyncio.wait(tasks.values(), timeout=SHUTDOWN_TIMEOUT_S)
            if pending:
                log.warning("%d run(s) did not stop in time", len(pending))

    def launch(self, batch: Batch) -> None:
        """Start a task for each run of a freshly created batch (`batch.runs`)."""
        assert batch.runs is not None
        self._batch_slots[batch.id] = asyncio.Semaphore(batch.concurrency)
        for run in batch.runs:
            job = RunJob(
                run_id=run.id,
                batch_id=run.batch_id,
                thread_id=run.thread_id,
                snapshot=run.snapshot,
                out_dir=self.artifacts_dir(run.id),
            )
            task = asyncio.create_task(self._execute(job), name=f"run-{run.id}")
            self._tasks[run.id] = task
            self._jobs[run.id] = job
            self.hub.open(run.id, run.batch_id)
            task.add_done_callback(lambda _, run_id=run.id: self._forget(run_id))

    def _forget(self, run_id: uuid.UUID) -> None:
        self._tasks.pop(run_id, None)
        self._entered.discard(run_id)
        job = self._jobs.pop(run_id, None)
        if job is not None and not any(j.batch_id == job.batch_id for j in self._jobs.values()):
            self._batch_slots.pop(job.batch_id, None)

    def is_active(self, run_id: uuid.UUID) -> bool:
        return run_id in self._tasks

    async def cancel_run(self, run: Run | uuid.UUID) -> bool:
        """Cancel the run's task; a run without a live task is recorded as cancelled directly.

        Returns False when the run had already ended (nothing was cancelled).
        """
        run_id = run if isinstance(run, uuid.UUID) else run.id
        task = self._tasks.get(run_id)
        if task is not None:
            task.cancel()
            if run_id in self._entered:
                return True  # the task records its own end
        job = self._jobs.get(run_id)
        batch_id = job.batch_id if job else (run.batch_id if isinstance(run, Run) else None)
        if batch_id is None:
            async with self.sessionmaker() as db:
                batch_id = (await service.get_run(db, run_id)).batch_id
        return await self._record_end(run_id, batch_id, self._cancel_status(), None, None)

    def _cancel_status(self) -> tuple[RunStatus, str]:
        if self._stopping:
            return RunStatus.INTERRUPTED, "shutdown"
        return RunStatus.CANCELLED, "cancelled"

    # --- one run --------------------------------------------------------------------------

    async def _execute(self, job: RunJob) -> None:
        self._entered.add(job.run_id)
        outcome: tuple[RunStatus, str | None] = (RunStatus.FAILED, "internal_error")
        summary: dict[str, Any] | None = None
        error: str | None = None
        started = False
        try:
            async with self._batch_slots[job.batch_id], self._slots:
                async with self.sessionmaker() as db:
                    await service.mark_started(db, job.run_id, job.batch_id)
                publish(self.hub.status, job.run_id, RunStatus.CONNECTING.value)
                started = True
                summary = await self.drive(job, RunEventSink(self, job))
                outcome = _outcome(summary)
                error = summary.get("error") if outcome[0] is RunStatus.FAILED else None
        except asyncio.CancelledError:
            outcome = self._cancel_status()
            summary = read_json(job.out_dir / "summary.json") if started else None
            raise
        except RunSetupError as exc:
            outcome, error = (RunStatus.FAILED, "setup_failed"), str(exc)
        except Exception as exc:
            log.exception("run %s failed", job.run_id)
            error = f"internal error ({type(exc).__name__})"
        finally:
            artifacts = str(job.out_dir) if job.out_dir.is_dir() else None  # noqa: ASYNC240
            await asyncio.shield(
                self._record_end(
                    job.run_id, job.batch_id, outcome, summary, error, artifacts_dir=artifacts
                )
            )

    async def _record_end(
        self,
        run_id: uuid.UUID,
        batch_id: uuid.UUID,
        outcome: tuple[RunStatus, str | None],
        summary: dict[str, Any] | None,
        error: str | None,
        *,
        artifacts_dir: str | None = None,
    ) -> bool:
        """Record the run's end (once); returns whether this call recorded it."""
        status, reason = outcome
        recorded = False
        try:
            async with self.sessionmaker() as db:
                recorded = await service.mark_finished(
                    db,
                    run_id,
                    batch_id,
                    status=status,
                    reason=reason,
                    summary=summary,
                    artifacts_dir=artifacts_dir,
                    error=error,
                )
        except Exception:
            log.exception("could not record the end of run %s", run_id)
        publish(self.hub.finish, run_id, status.value, reason)
        # A crash before `schedule` leaves the run unjudged; the coordinator's `recover`
        # reconciles recent ones at the next start.
        if recorded and self.judgements is not None and is_judgeable(status, summary):
            try:
                await self.judgements.schedule(run_id)
            except Exception as exc:  # the run itself is over and recorded either way
                log.warning(
                    "could not schedule the judgement of run %s (%s)", run_id, type(exc).__name__
                )
        return recorded

    async def drive_session(self, job: RunJob, sink: EventSink) -> dict[str, Any]:
        """The real conversation: providers from the stored connections, then the runner."""
        snapshot = job.snapshot
        connections = snapshot["connections"]
        async with self.sessionmaker() as db:
            try:
                policy = await self.build_policy(db, uuid.UUID(connections["evaluator"]["id"]))
            except Exception as exc:
                raise _provider_error("evaluator", exc) from None
            try:
                synthesizer = await self.build_synthesizer(
                    db, uuid.UUID(connections["tts"]["id"]), snapshot["scenario"]["voice_override"]
                )
            except Exception as exc:
                raise _provider_error("voice", exc) from None
        agent = snapshot["agent"]
        end = snapshot["scenario"]["end_conditions"]
        runner = SessionRunner(
            TargetSpec(
                base_url=agent["base_url"],
                channel_id=agent["channel_id"],
                user_id=agent["user_id"],
                thread_id=job.thread_id,
                origin=agent["origin"],
                protocol=agent["protocol"],
            ),
            brief=brief_from_snapshot(snapshot),
            policy=policy,
            synthesizer=synthesizer,
            sink=sink,
            out_dir=job.out_dir,
            options=SessionOptions(
                max_duration_s=end["max_duration_s"],
                max_silence_s=end["max_silence_s"],
                hang_up_when=end["hang_up_when"],
                **self.session_overrides,
            ),
        )
        return await runner.run()

    async def _build_policy(self, db: AsyncSession, connection_id: uuid.UUID) -> CallerPolicy:
        return await build_caller_policy(
            db, connection_id, secret_box=self.secret_box, allow_local_http=self.allow_local_http
        )

    async def _build_synthesizer(
        self, db: AsyncSession, connection_id: uuid.UUID, voice: str | None
    ) -> SpeechSynthesizer:
        return await build_synthesizer(
            db,
            connection_id,
            secret_box=self.secret_box,
            allow_local_http=self.allow_local_http,
            voice=voice,
        )


def is_judgeable(status: RunStatus, summary: dict[str, Any] | None) -> bool:
    """A completed run, or a failed one in which the agent took at least one turn."""
    if status is RunStatus.COMPLETED:
        return True
    if status is not RunStatus.FAILED or not summary:
        return False
    turns = summary.get("agent_turns")
    return isinstance(turns, int) and turns > 0


def _outcome(summary: dict[str, Any]) -> tuple[RunStatus, str | None]:
    try:
        status = RunStatus(summary.get("status"))
    except ValueError:
        return RunStatus.FAILED, "internal_error"
    return status, summary.get("reason")
