"""Scenarios domain: what the simulated caller is, knows, wants, and how the call is judged.

The structured parts (persona, facts, criteria, end conditions) are pydantic models: the API
validates requests with them and the database stores them as JSON (snake_case keys).
Validation errors carry the field location and a message, never the submitted value.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic.alias_generators import to_camel

from voice_eval.modules.connections.domain import DEFAULT_REALTIME_MODEL, RealtimeModel
from voice_eval.ports.policy import CallerBrief
from voice_eval.ports.realtime_caller import REALTIME_VOICES

# Column sizes shared by the models, the API schemas and the use cases (migrations keep literals).
MAX_NAME_LENGTH = 160
MAX_TAGS = 20
MAX_TAG_LENGTH = 40
MAX_CONTEXT_LENGTH = 20000
MAX_GOAL_LENGTH = 5000
MAX_INSTRUCTIONS_LENGTH = 10000
MAX_PERSONA_NAME_LENGTH = 120
MAX_PERSONA_NOTES_LENGTH = 2000
MAX_FACTS = 50
MAX_FACT_KEY_LENGTH = 80
MAX_FACT_VALUE_LENGTH = 500
MAX_CRITERIA = 30
MAX_CRITERION_TEXT_LENGTH = 500
CRITERIA_WEIGHT_TOTAL = 100
MAX_INTERRUPTIONS = 10
MIN_INTERRUPT_AFTER_MS = 300
MAX_INTERRUPT_AFTER_MS = 60000
COPY_SUFFIX = " (copy)"


class Temperament(StrEnum):
    POLITE = "polite"
    HURRIED = "hurried"
    SKEPTICAL = "skeptical"
    CONFUSED = "confused"
    ANGRY = "angry"
    FRIENDLY = "friendly"
    CALM = "calm"
    DETAILED = "detailed"


class CriterionKind(StrEnum):
    MUST = "must"
    SHOULD = "should"


class EvidenceSource(StrEnum):
    TRANSCRIPT = "transcript"
    TRACE = "trace"
    TIMING = "timing"


class EvaluatorMode(StrEnum):
    """Who plays the caller: a chat model + TTS voice, or a speech-to-speech realtime model."""

    PIPELINE = "pipeline"
    REALTIME = "realtime"


class HangUpWhen(StrEnum):
    GOAL_OR_GOODBYE = "goal_or_goodbye"
    GOODBYE = "goodbye"
    MAX_DURATION = "max_duration"


def _text(max_length: int, *, min_length: int = 0) -> StringConstraints:
    return StringConstraints(strip_whitespace=True, min_length=min_length, max_length=max_length)


Tag = Annotated[str, _text(MAX_TAG_LENGTH, min_length=1)]
PersonaName = Annotated[str, _text(MAX_PERSONA_NAME_LENGTH, min_length=1)]
PersonaNotes = Annotated[str, _text(MAX_PERSONA_NOTES_LENGTH)]
FactKey = Annotated[str, _text(MAX_FACT_KEY_LENGTH, min_length=1)]
FactValue = Annotated[str, _text(MAX_FACT_VALUE_LENGTH, min_length=1)]
CriterionText = Annotated[str, _text(MAX_CRITERION_TEXT_LENGTH, min_length=1)]
Locale = Annotated[  # BCP 47-like: es, es-MX, zh-Hant-TW
    str,
    StringConstraints(
        strip_whitespace=True, max_length=35, pattern=r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$"
    ),
]


DEFAULT_MAX_TURNS = 20
MAX_MAX_TURNS = 100


class _Model(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        hide_input_in_errors=True,
    )


class Persona(_Model):
    name: PersonaName
    locale: Locale
    temperament: Temperament
    notes: PersonaNotes = ""


class Fact(_Model):
    """Something the caller knows and reveals only when asked."""

    key: FactKey
    value: FactValue


class Criterion(_Model):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)  # stable once stored
    text: CriterionText
    kind: CriterionKind
    source: EvidenceSource
    weight: int = Field(ge=1, le=CRITERIA_WEIGHT_TOTAL)


class EndConditions(_Model):
    """When a run ends. `max_silence_s` applies to voice agents only; `max_turns` (messages the
    user sends) to text agents only. Rows stored before `max_turns` read with its default."""

    max_duration_s: int = Field(default=360, ge=30, le=1800)
    max_silence_s: int = Field(default=15, ge=5, le=120)
    hang_up_when: HangUpWhen = HangUpWhen.GOAL_OR_GOODBYE
    max_turns: int = Field(default=DEFAULT_MAX_TURNS, ge=1, le=MAX_MAX_TURNS)


class Interruption(_Model):
    """The caller barges in on the agent's `agent_turn`-th reply (from 1) once `after_ms` of it
    has played, like a person cutting the agent off mid-sentence."""

    agent_turn: int = Field(ge=1)
    after_ms: int = Field(ge=MIN_INTERRUPT_AFTER_MS, le=MAX_INTERRUPT_AFTER_MS)


Tags = Annotated[list[Tag], Field(max_length=MAX_TAGS)]
Facts = Annotated[list[Fact], Field(max_length=MAX_FACTS)]
Criteria = Annotated[list[Criterion], Field(min_length=1, max_length=MAX_CRITERIA)]
Interruptions = Annotated[list[Interruption], Field(max_length=MAX_INTERRUPTIONS)]


def unique_tags(tags: list[str]) -> list[str]:
    """Tags in their first order, without repeats."""
    return list(dict.fromkeys(tags))


def check_facts(facts: list[Fact]) -> list[Fact]:
    keys = [fact.key.casefold() for fact in facts]
    if len(set(keys)) != len(keys):
        raise ValueError("fact keys must be unique")
    return facts


def check_criteria(criteria: list[Criterion]) -> list[Criterion]:
    if len({criterion.id for criterion in criteria}) != len(criteria):
        raise ValueError("criterion ids must be unique")
    total = sum(criterion.weight for criterion in criteria)
    if total != CRITERIA_WEIGHT_TOTAL:
        raise ValueError(
            f"criteria weights must total {CRITERIA_WEIGHT_TOTAL} (they total {total})"
        )
    return criteria


def voice_error(mode: str, voice_override: str | None) -> str | None:
    """Why `voice_override` cannot be used by the `mode` evaluator, or None."""
    if mode == EvaluatorMode.REALTIME and voice_override and voice_override not in REALTIME_VOICES:
        return f"the realtime evaluator needs one of its voices: {', '.join(REALTIME_VOICES)}"
    return None


def check_interruptions(interruptions: list[Interruption]) -> list[Interruption]:
    turns = [interruption.agent_turn for interruption in interruptions]
    if len(set(turns)) != len(turns):
        raise ValueError("each agent turn can be interrupted only once")
    return interruptions


class ScenarioRules(BaseModel):
    """Mixin of the cross-item rules, for any request model that has these fields."""

    @field_validator("tags", check_fields=False)
    @classmethod
    def _unique_tags(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else unique_tags(value)

    @field_validator("facts", check_fields=False)
    @classmethod
    def _check_facts(cls, value: list[Fact] | None) -> list[Fact] | None:
        return None if value is None else check_facts(value)

    @field_validator("criteria", check_fields=False)
    @classmethod
    def _check_criteria(cls, value: list[Criterion] | None) -> list[Criterion] | None:
        return None if value is None else check_criteria(value)

    @field_validator("interruptions", check_fields=False)
    @classmethod
    def _check_interruptions(cls, value: list[Interruption] | None) -> list[Interruption] | None:
        return None if value is None else check_interruptions(value)


@dataclass(frozen=True)
class AgentSummary:
    id: uuid.UUID
    name: str


@dataclass(frozen=True)
class GroupSummary:
    id: uuid.UUID
    name: str


@dataclass(frozen=True)
class ScenarioGroup:
    """A folder of scenarios; its scenarios may belong to different agents."""

    id: uuid.UUID
    name: str
    description: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    scenario_count: int = 0
    # The agents its scenarios are written against, by name.
    agents: list[AgentSummary] = field(default_factory=list)
    # When one of its scenarios last changed; `None` while it is empty.
    latest_scenario_at: datetime | None = None


@dataclass(frozen=True)
class Scenario:
    id: uuid.UUID
    agent: AgentSummary
    name: str
    tags: list[str]
    context: str
    persona: Persona
    tts_connection_id: uuid.UUID | None
    evaluator_connection_id: uuid.UUID | None
    voice_override: str | None
    goal: str
    instructions: str
    facts: list[Fact]
    criteria: list[Criterion]
    end_conditions: EndConditions
    created_at: datetime
    updated_at: datetime
    interruptions: list[Interruption] = field(default_factory=list)
    evaluator_mode: EvaluatorMode = EvaluatorMode.PIPELINE
    # Used only by the realtime evaluator.
    realtime_model: RealtimeModel = DEFAULT_REALTIME_MODEL
    # Every stored scenario has one; `None` only for scenarios built outside the database.
    group: GroupSummary | None = None


class ScenarioNotFound(Exception):
    pass


class ScenarioNameTaken(Exception):
    pass


class ScenarioConflict(Exception):
    """The write conflicts with a concurrent change (e.g. a referenced row was deleted)."""


class GroupNotFound(Exception):
    pass


class GroupNameTaken(Exception):
    pass


class GroupNotEmpty(Exception):
    """A group is deleted only once it holds no scenarios."""

    def __init__(self, scenario_count: int) -> None:
        super().__init__(f"group holds {scenario_count} scenario(s)")
        self.scenario_count = scenario_count


class InvalidScenarioInput(ValueError):
    """`errors` is a list of `{"type", "loc", "msg"}` items; never the submitted value."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        super().__init__("invalid scenario input")
        self.errors = errors


class ScenarioNotRunnable(Exception):
    """The scenario cannot be run as configured; `reason` tells the user what to change."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ConnectionRef:
    """A provider connection as a run role sees it; `chat_model` None: it cannot chat."""

    id: uuid.UUID
    name: str
    chat_model: str | None


def resolve_evaluator(
    *, evaluator: ConnectionRef | None, tts: ConnectionRef | None
) -> ConnectionRef:
    """The connection whose chat model plays the caller: the scenario's evaluator connection,
    else its voice (TTS) connection when that one has a chat model.

    Raises `ScenarioNotRunnable` with a reason the user can act on.
    """
    if evaluator is not None:
        if evaluator.chat_model is None:
            raise ScenarioNotRunnable(
                f"the evaluator model connection {evaluator.name!r} has no chat model; "
                "set its chat deployment or choose another connection"
            )
        return evaluator
    if tts is not None and tts.chat_model is not None:
        return tts
    if tts is not None:
        raise ScenarioNotRunnable(
            f"the voice connection {tts.name!r} has no chat deployment; set one or choose an "
            "evaluator model connection"
        )
    raise ScenarioNotRunnable(
        "choose an evaluator model connection (or a voice connection with a chat model)"
    )


def caller_brief(scenario: Scenario, *, agent_context: str) -> CallerBrief:
    """What the evaluator plays in one run of `scenario` (its agent's shared context first)."""
    return CallerBrief(
        agent_context=agent_context,
        scenario_context=scenario.context,
        persona_name=scenario.persona.name,
        locale=scenario.persona.locale,
        temperament=scenario.persona.temperament.value,
        persona_notes=scenario.persona.notes,
        goal=scenario.goal,
        instructions=scenario.instructions,
        facts=tuple((fact.key, fact.value) for fact in scenario.facts),
        hang_up_when=scenario.end_conditions.hang_up_when.value,
        max_duration_s=scenario.end_conditions.max_duration_s,
    )


def copy_name(name: str, taken: set[str]) -> str:
    """`<name> (copy)`, then `(copy 2)`, `(copy 3)`…: the first not in `taken`, within limits."""
    n = 1
    while True:
        suffix = COPY_SUFFIX if n == 1 else f" (copy {n})"
        candidate = name[: MAX_NAME_LENGTH - len(suffix)].rstrip() + suffix
        if candidate not in taken:
            return candidate
        n += 1
