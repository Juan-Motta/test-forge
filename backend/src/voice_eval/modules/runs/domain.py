"""Runs domain: batches of evaluator conversations, each run's state machine, and the snapshot.

A run stores a snapshot of the scenario, agent and caller brief it was launched with, so later
edits never change history. It moves `queued` -> `connecting` -> `running` -> one terminal
status: `completed`, `failed`, `cancelled`, or `interrupted` (the server stopped under it).
"""

import math
import re
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from voice_eval.modules.agents.domain import Agent
from voice_eval.modules.scenarios.domain import ConnectionRef, Scenario, caller_brief
from voice_eval.ports.policy import CallerBrief

MAX_LABEL_LENGTH = 120
MAX_ERROR_LENGTH = 500
MAX_SCENARIOS_PER_BATCH = 20
MAX_REPETITIONS = 10
MAX_BATCH_CONCURRENCY = 10
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f-\x9f]")


class RunStatus(StrEnum):
    QUEUED = "queued"
    CONNECTING = "connecting"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"


class BatchStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


ACTIVE_RUN_STATUSES = frozenset({RunStatus.QUEUED, RunStatus.CONNECTING, RunStatus.RUNNING})
ACTIVE_BATCH_STATUSES = frozenset({BatchStatus.QUEUED, BatchStatus.RUNNING})


@dataclass(frozen=True)
class Run:
    id: uuid.UUID
    batch_id: uuid.UUID
    position: int
    scenario_id: uuid.UUID | None
    agent_id: uuid.UUID | None
    thread_id: str
    status: RunStatus
    end_reason: str | None
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    summary: dict[str, Any] | None
    artifacts_dir: str | None
    error: str | None
    snapshot: dict[str, Any]
    judgement_status: str | None = None  # from the run's judgement, when it has one
    score: int | None = None  # the judgement's overall score, once completed
    must_failed: bool | None = None  # whether a must criterion failed, once completed
    judge_usage: dict[str, Any] | None = None  # the judge's usage over every judgement attempt

    @property
    def langfuse_session_id(self) -> str:
        """The Langfuse `sessionId` of the run's traces: the run's thread id, except for a relay
        agent, whose session is the one it reported (created by its session URL)."""
        summary = self.summary if isinstance(self.summary, dict) else {}
        session = summary.get("session_id")
        if summary.get("protocol") == "relay" and isinstance(session, str) and session:
            return session
        return self.thread_id

    @property
    def caller_usage(self) -> dict[str, Any] | None:
        """The evaluator's caller usage of the summary (None for runs before usage capture)."""
        usage = self.summary.get("usage") if isinstance(self.summary, dict) else None
        return usage if isinstance(usage, dict) else None

    @property
    def scenario_name(self) -> str:
        return self.snapshot["scenario"]["name"]

    @property
    def agent_name(self) -> str:
        return self.snapshot["agent"]["name"]

    @property
    def persona(self) -> str | None:
        persona = self.snapshot["scenario"].get("persona")
        name = persona.get("name") if isinstance(persona, dict) else None
        return name if isinstance(name, str) else None

    @property
    def caller_turns(self) -> int | None:
        return _count(self.summary, "caller_turns")

    @property
    def agent_turns(self) -> int | None:
        return _count(self.summary, "agent_turns")

    @property
    def latency_p50_ms(self) -> int | None:
        """The median response latency of the summary, rounded to whole milliseconds."""
        values = self.summary.get("latencies_ms") if isinstance(self.summary, dict) else None
        numbers = [v for v in values if _is_number(v)] if isinstance(values, list) else []
        if not numbers:
            return None
        ordered = sorted(numbers)
        middle = len(ordered) // 2
        # Halve before adding so two huge finite values never overflow to inf.
        median = (
            ordered[middle] if len(ordered) % 2 else ordered[middle - 1] / 2 + ordered[middle] / 2
        )
        return round(median) if math.isfinite(median) else None

    @property
    def finished(self) -> bool:
        return self.status not in ACTIVE_RUN_STATUSES


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _count(summary: dict[str, Any] | None, key: str) -> int | None:
    """A non-negative integer of the summary; None when missing or malformed."""
    value = summary.get(key) if isinstance(summary, dict) else None
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None


@dataclass(frozen=True)
class Batch:
    id: uuid.UUID
    label: str | None
    concurrency: int
    status: BatchStatus
    total: int
    counts: dict[str, int]
    created_by: uuid.UUID | None
    created_at: datetime
    runs: list[Run] | None = None  # only when asked for


class RunNotFound(Exception):
    pass


class BatchNotFound(Exception):
    pass


class RunFinished(Exception):
    """The run (or every run of the batch) already reached a terminal status."""


class ScenariosNotRunnable(Exception):
    """`errors` is a list of `{"index", "scenario_id", "msg"}` items, one per refused scenario."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        super().__init__("some scenarios cannot run")
        self.errors = errors


@dataclass(frozen=True)
class RunPlan:
    """One launchable scenario with everything resolved at launch time."""

    scenario: Scenario
    agent: Agent
    tts: ConnectionRef | None  # None for a text agent (no voice)
    evaluator: ConnectionRef


def sanitize_error(message: str | None) -> str | None:
    """A single printable line of at most `MAX_ERROR_LENGTH` characters (None stays None)."""
    if message is None:
        return None
    line = " ".join(CONTROL_CHARACTERS.sub(" ", message).split())
    if len(line) > MAX_ERROR_LENGTH:
        line = line[: MAX_ERROR_LENGTH - 1] + "…"
    return line or None


def snapshot(plan: RunPlan) -> dict[str, Any]:
    """What a run is launched with, as JSON (snake_case keys); never a secret."""
    scenario, agent = plan.scenario, plan.agent
    brief = caller_brief(scenario, agent_context=agent.context)
    return {
        "scenario": {
            "id": str(scenario.id),
            "name": scenario.name,
            "tags": list(scenario.tags),
            "context": scenario.context,
            "persona": scenario.persona.model_dump(mode="json"),
            "goal": scenario.goal,
            "instructions": scenario.instructions,
            "facts": [fact.model_dump(mode="json") for fact in scenario.facts],
            "criteria": [criterion.model_dump(mode="json") for criterion in scenario.criteria],
            "end_conditions": scenario.end_conditions.model_dump(mode="json"),
            "interruptions": [item.model_dump(mode="json") for item in scenario.interruptions],
            "voice_override": scenario.voice_override,
            "evaluator_mode": scenario.evaluator_mode.value,
            "realtime_model": scenario.realtime_model.value,
        },
        "agent": {  # never the API key of a text agent: only whether it has one
            "id": str(agent.id),
            "name": agent.name,
            "kind": agent.kind.value,
            "context": agent.context,
            "protocol": agent.protocol.value,
            "base_url": agent.base_url,
            "channel_id": agent.channel_id,
            "user_id": agent.user_id,
            "origin": agent.origin,
            "session_url": agent.session_url,
            "text_mode": agent.text_mode.value if agent.text_mode else None,
            "auth": agent.auth.value if agent.auth else None,
            "has_api_key": agent.has_api_key,
            "langfuse_connection_id": (
                str(agent.langfuse_connection_id) if agent.langfuse_connection_id else None
            ),
        },
        "brief": asdict(brief),
        "connections": {
            "tts": {"id": str(plan.tts.id), "name": plan.tts.name} if plan.tts else None,
            "evaluator": {
                "id": str(plan.evaluator.id),
                "name": plan.evaluator.name,
                "chat_model": plan.evaluator.chat_model,
            },
        },
    }


def brief_from_snapshot(data: dict[str, Any]) -> CallerBrief:
    brief = dict(data["brief"])
    brief["facts"] = tuple((key, value) for key, value in brief["facts"])
    return CallerBrief(**brief)
