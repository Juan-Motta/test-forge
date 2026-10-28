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

A scenario with the realtime evaluator (`evaluator_mode` "realtime" in its snapshot) builds a
realtime caller of its `realtime_model` from its voice connection instead of the policy and the
synthesizer.

A text agent (`kind` "text" in the agent snapshot) is chatted with by a `TextSessionRunner`
instead: the evaluator model's policy writes the messages, no voice is used, and the chat
target is built from the snapshot with the agent's API key opened from the database at run time
(it is never in the snapshot). Voice-only scenario settings are ignored with a warning.

The factories (`build_policy`, `build_synthesizer`, `build_realtime_caller`,
`build_text_target`), the text agents' HTTP transport (`text_transport`, None: the
egress-guarded default) and the whole `drive` step are attributes, so tests replace them and
never contact a provider or an agent.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from voice_eval.modules.agents import service as agents
from voice_eval.modules.agents.domain import AgentNotFound
from voice_eval.modules.connections.domain import DEFAULT_REALTIME_MODEL, UnsupportedConnection
from voice_eval.modules.connections.runtime import (
    build_caller_policy,
    build_realtime_caller,
    build_synthesizer,
)
from voice_eval.modules.runs import service
from voice_eval.modules.runs.domain import Batch, Run, RunStatus, brief_from_snapshot
from voice_eval.modules.runs.live import LiveHub
from voice_eval.platform.secrets import SecretBox, SecretDecryptionError
from voice_eval.ports.policy import CallerPolicy
from voice_eval.ports.realtime_caller import RealtimeCaller
from voice_eval.ports.text_target import TextTarget
from voice_eval.ports.tts import SpeechSynthesizer
from voice_eval.runner.barge_in import Interruption
from voice_eval.runner.events import EventSink, RunEvent
from voice_eval.runner.session import SessionOptions, SessionRunner
from voice_eval.runner.text_session import (
    DEFAULT_MAX_TURNS,
    TextSessionOptions,
    TextSessionRunner,
)
from voice_eval.targets.connection import dial_base_url
from voice_eval.targets.detect import TargetSpec
from voice_eval.targets.http_chat import HttpChatTarget

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
RealtimeCallerFactory = Callable[
    [AsyncSession, uuid.UUID, str | None, str], Awaitable[RealtimeCaller]
]
TextTargetFactory = Callable[[AsyncSession, dict[str, Any]], Awaitable[TextTarget]]


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
        local_target_host: str | None = None,
    ) -> None:
        self.sessionmaker = sessionmaker
        self.local_target_host = local_target_host
        self.judgements = judgements
        self.secret_box = secret_box
        self.data_dir = data_dir
        self.allow_local_http = allow_local_http
        self.drive: Drive = self.drive_session
        self.build_policy: PolicyFactory = self._build_policy
        self.build_synthesizer: SynthesizerFactory = self._build_synthesizer
        self.build_realtime_caller: RealtimeCallerFactory = self._build_realtime_caller
        self.build_text_target: TextTargetFactory = self._build_text_target
        self.text_transport: httpx.AsyncBaseTransport | None = None
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
        if snapshot["agent"].get("kind") == "text":
            return await self.drive_text_session(job, sink)
        connections = snapshot["connections"]
        voice = snapshot["scenario"]["voice_override"]
        tts_id = uuid.UUID(connections["tts"]["id"])
        policy: CallerPolicy | None = None
        synthesizer: SpeechSynthesizer | None = None
        realtime: RealtimeCaller | None = None
        model: str | None = None
        async with self.sessionmaker() as db:
            if evaluator_mode(snapshot) == "realtime":
                model = realtime_model(snapshot)
                try:  # the voice connection hosts the realtime model too
                    realtime = await self.build_realtime_caller(db, tts_id, voice, model)
                except Exception as exc:
                    raise _provider_error("voice", exc) from None
            else:
                try:
                    policy = await self.build_policy(db, uuid.UUID(connections["evaluator"]["id"]))
                except Exception as exc:
                    raise _provider_error("evaluator", exc) from None
                try:
                    synthesizer = await self.build_synthesizer(db, tts_id, voice)
                except Exception as exc:
                    raise _provider_error("voice", exc) from None
        end = snapshot["scenario"]["end_conditions"]
        runner = SessionRunner(
            run_target_spec(
                snapshot["agent"], job.thread_id, local_target_host=self.local_target_host
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
                interruptions=interruptions_from_snapshot(snapshot),
                **self.session_overrides,
            ),
            realtime=realtime,
            realtime_model=model,
        )
        return await runner.run()

    async def drive_text_session(self, job: RunJob, sink: EventSink) -> dict[str, Any]:
        """A chat with a text agent: the evaluator model's policy and the agent's chat target."""
        snapshot = job.snapshot
        evaluator_id = uuid.UUID(snapshot["connections"]["evaluator"]["id"])
        async with self.sessionmaker() as db:
            try:
                policy = await self.build_policy(db, evaluator_id)
            except Exception as exc:
                raise _provider_error("evaluator", exc) from None
            target = await self.build_text_target(db, snapshot["agent"])
        end = snapshot["scenario"]["end_conditions"]
        overrides = {
            key: value
            for key, value in self.session_overrides.items()
            if key in TextSessionOptions.__dataclass_fields__
        }
        runner = TextSessionRunner(
            target=target,
            thread_id=job.thread_id,
            brief=brief_from_snapshot(snapshot),
            policy=policy,
            sink=sink,
            out_dir=job.out_dir,
            options=TextSessionOptions(
                max_turns=end.get("max_turns") or DEFAULT_MAX_TURNS,
                max_duration_s=end["max_duration_s"],
                hang_up_when=end["hang_up_when"],
                **overrides,
            ),
            channel_id=snapshot["agent"]["channel_id"],
            text_mode=snapshot["agent"].get("text_mode") or "stream",
            notices=ignored_voice_settings(snapshot),
        )
        return await runner.run()

    async def _build_text_target(self, db: AsyncSession, agent: dict[str, Any]) -> TextTarget:
        """The chat target as the snapshot describes it; the API key is read now, never stored
        in the snapshot. Loopback hosts are dialled like voice agents (`local_target_host`)."""
        api_key = None
        if agent.get("auth") == "api_key":
            try:
                api_key = await agents.agent_api_key(db, self.secret_box, uuid.UUID(agent["id"]))
            except AgentNotFound:
                raise RunSetupError("the agent of this run no longer exists") from None
            except SecretDecryptionError:
                raise RunSetupError(
                    "the agent's API key cannot be decrypted (wrong VOICE_EVAL_MASTER_KEY?)"
                ) from None
        return HttpChatTarget(
            base_url=dial_base_url(agent["base_url"], self.local_target_host),
            channel_id=agent["channel_id"],
            mode=agent.get("text_mode") or "stream",
            api_key=api_key,
            origin=agent.get("origin"),
            transport=self.text_transport,
            allow_private=self.allow_local_http,  # development only, like the connection test
        )

    async def _build_policy(self, db: AsyncSession, connection_id: uuid.UUID) -> CallerPolicy:
        return await build_caller_policy(
            db, connection_id, secret_box=self.secret_box, allow_local_http=self.allow_local_http
        )

    async def _build_realtime_caller(
        self, db: AsyncSession, connection_id: uuid.UUID, voice: str | None, model: str
    ) -> RealtimeCaller:
        return await build_realtime_caller(
            db,
            connection_id,
            secret_box=self.secret_box,
            allow_local_http=self.allow_local_http,
            voice=voice,
            model=model,
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


def run_target_spec(
    agent: dict[str, Any], thread_id: str, *, local_target_host: str | None
) -> TargetSpec:
    """The target of one run from its agent snapshot, dialled through `local_target_host` when
    the agent is on a loopback host (the Origin header is sent as configured)."""
    return TargetSpec(
        base_url=dial_base_url(agent["base_url"], local_target_host),
        channel_id=agent["channel_id"],
        user_id=agent["user_id"] or "",  # a relay agent has none
        thread_id=thread_id,
        origin=agent["origin"],
        protocol=agent["protocol"],
        session_url=_dial(agent.get("session_url"), local_target_host),
    )


def _dial(url: str | None, local_target_host: str | None) -> str | None:
    return None if url is None else dial_base_url(url, local_target_host)


def ignored_voice_settings(snapshot: dict[str, Any]) -> tuple[str, ...]:
    """Warnings for the voice-only settings a text run ignores (set on its scenario)."""
    scenario = snapshot["scenario"]
    notices = []
    if scenario.get("voice_override"):
        notices.append("the scenario's voice is ignored: text agents are chatted with")
    if scenario.get("interruptions"):
        notices.append("the scenario's interruptions are ignored in text runs")
    if evaluator_mode(snapshot) == "realtime":
        notices.append(
            "the realtime evaluator is ignored in text runs: the evaluator model writes the "
            "messages"
        )
    return tuple(notices)


def evaluator_mode(snapshot: dict[str, Any]) -> str:
    """The scenario's evaluator (snapshots from before it was chosen are pipeline runs)."""
    return snapshot["scenario"].get("evaluator_mode") or "pipeline"


def realtime_model(snapshot: dict[str, Any]) -> str:
    """The scenario's realtime model (snapshots from before it was chosen used the default)."""
    return snapshot["scenario"].get("realtime_model") or DEFAULT_REALTIME_MODEL.value


def interruptions_from_snapshot(snapshot: dict[str, Any]) -> tuple[Interruption, ...]:
    """The scenario's barge-ins (snapshots from before they existed have none)."""
    items = snapshot["scenario"].get("interruptions") or []
    return tuple(Interruption(item["agent_turn"], item["after_ms"]) for item in items)


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
