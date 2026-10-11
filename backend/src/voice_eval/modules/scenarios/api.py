"""HTTP API of the scenarios module: `/api/scenarios/*` (behind authentication)."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.connections.domain import Identifier
from voice_eval.modules.scenarios import service
from voice_eval.modules.scenarios.domain import (
    MAX_CONTEXT_LENGTH,
    MAX_GOAL_LENGTH,
    MAX_INSTRUCTIONS_LENGTH,
    MAX_NAME_LENGTH,
    MAX_TAG_LENGTH,
    Criteria,
    Criterion,
    EndConditions,
    Fact,
    Facts,
    InvalidScenarioInput,
    Persona,
    Scenario,
    ScenarioConflict,
    ScenarioNameTaken,
    ScenarioNotFound,
    ScenarioRules,
    Tags,
)
from voice_eval.modules.users.deps import Principal, current_principal
from voice_eval.platform.db import get_db_session

Db = Annotated[AsyncSession, Depends(get_db_session)]
CurrentPrincipal = Annotated[Principal, Depends(current_principal)]


def _text(max_length: int, *, min_length: int = 0) -> StringConstraints:
    return StringConstraints(strip_whitespace=True, min_length=min_length, max_length=max_length)


Name = Annotated[str, _text(MAX_NAME_LENGTH, min_length=1)]
Context = Annotated[str, _text(MAX_CONTEXT_LENGTH)]
Goal = Annotated[str, _text(MAX_GOAL_LENGTH, min_length=1)]
Instructions = Annotated[str, _text(MAX_INSTRUCTIONS_LENGTH)]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StrictCamelModel(CamelModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class AgentSummaryOut(CamelModel):
    id: uuid.UUID
    name: str


class ScenarioOut(CamelModel):
    id: uuid.UUID
    agent_id: uuid.UUID
    agent: AgentSummaryOut
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

    @classmethod
    def of(cls, scenario: Scenario) -> "ScenarioOut":
        return cls(
            id=scenario.id,
            agent_id=scenario.agent.id,
            agent=AgentSummaryOut(id=scenario.agent.id, name=scenario.agent.name),
            name=scenario.name,
            tags=scenario.tags,
            context=scenario.context,
            persona=scenario.persona,
            tts_connection_id=scenario.tts_connection_id,
            evaluator_connection_id=scenario.evaluator_connection_id,
            voice_override=scenario.voice_override,
            goal=scenario.goal,
            instructions=scenario.instructions,
            facts=scenario.facts,
            criteria=scenario.criteria,
            end_conditions=scenario.end_conditions,
            created_at=scenario.created_at,
            updated_at=scenario.updated_at,
        )


class CreateIn(StrictCamelModel, ScenarioRules):
    agent_id: uuid.UUID
    name: Name
    tags: Tags = []
    context: Context = ""
    persona: Persona
    tts_connection_id: uuid.UUID | None = None
    evaluator_connection_id: uuid.UUID | None = None
    voice_override: Identifier | None = None
    goal: Goal
    instructions: Instructions = ""
    facts: Facts = []
    criteria: Criteria
    end_conditions: EndConditions = Field(default_factory=EndConditions)


class UpdateIn(StrictCamelModel, ScenarioRules):
    """Partial update: only the fields present change; structured parts are replaced whole.

    `null` clears `ttsConnectionId`, `evaluatorConnectionId` or `voiceOverride`; it is refused
    for every other field.
    """

    agent_id: uuid.UUID | None = None
    name: Name | None = None
    tags: Tags | None = None
    context: Context | None = None
    persona: Persona | None = None
    tts_connection_id: uuid.UUID | None = None
    evaluator_connection_id: uuid.UUID | None = None
    voice_override: Identifier | None = None
    goal: Goal | None = None
    instructions: Instructions | None = None
    facts: Facts | None = None
    criteria: Criteria | None = None
    end_conditions: EndConditions | None = None

    @field_validator(
        "agent_id",
        "name",
        "tags",
        "context",
        "persona",
        "goal",
        "instructions",
        "facts",
        "criteria",
        "end_conditions",
    )
    @classmethod
    def required_when_present(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("may be omitted but not null")
        return value


def _fields(body: BaseModel, names: Any) -> dict[str, Any]:
    """The named fields as validated objects (nested models stay models)."""
    return {name: getattr(body, name) for name in names}


def _invalid(exc: InvalidScenarioInput) -> HTTPException:
    """Same `{type, loc, msg}` items as request validation errors (see `platform.app`)."""
    detail = [
        {"type": error["type"], "loc": ["body", *error["loc"]], "msg": error["msg"]}
        for error in exc.errors
    ]
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def _name_taken() -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "Scenario name already in use for this agent")


def _conflict() -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT, "Scenario conflicts with a concurrent change; try again"
    )


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Scenario not found")


router = APIRouter(prefix="/scenarios", tags=["scenarios"])


@router.get("", response_model=list[ScenarioOut])
async def list_scenarios(
    db: Db,
    agent_id: Annotated[uuid.UUID | None, Query(alias="agentId")] = None,
    tag: Annotated[str | None, Query(max_length=MAX_TAG_LENGTH)] = None,
) -> list[ScenarioOut]:
    scenarios = await service.list_scenarios(db, agent_id=agent_id, tag=tag)
    return [ScenarioOut.of(scenario) for scenario in scenarios]


@router.post("", response_model=ScenarioOut, status_code=status.HTTP_201_CREATED)
async def create_scenario(body: CreateIn, principal: CurrentPrincipal, db: Db) -> ScenarioOut:
    try:
        created = await service.create_scenario(
            db, fields=_fields(body, CreateIn.model_fields), created_by=principal.user.id
        )
    except InvalidScenarioInput as exc:
        raise _invalid(exc) from None
    except ScenarioNameTaken:
        raise _name_taken() from None
    except ScenarioConflict:
        raise _conflict() from None
    return ScenarioOut.of(created)


@router.get("/{scenario_id}", response_model=ScenarioOut)
async def get_scenario(scenario_id: uuid.UUID, db: Db) -> ScenarioOut:
    try:
        return ScenarioOut.of(await service.get_scenario(db, scenario_id))
    except ScenarioNotFound:
        raise _not_found() from None


@router.patch("/{scenario_id}", response_model=ScenarioOut)
async def update_scenario(scenario_id: uuid.UUID, body: UpdateIn, db: Db) -> ScenarioOut:
    try:
        updated = await service.update_scenario(
            db, scenario_id, changes=_fields(body, body.model_fields_set)
        )
    except ScenarioNotFound:
        raise _not_found() from None
    except InvalidScenarioInput as exc:
        raise _invalid(exc) from None
    except ScenarioNameTaken:
        raise _name_taken() from None
    except ScenarioConflict:
        raise _conflict() from None
    return ScenarioOut.of(updated)


@router.delete("/{scenario_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scenario(scenario_id: uuid.UUID, db: Db) -> Response:
    try:
        await service.delete_scenario(db, scenario_id)
    except ScenarioNotFound:
        raise _not_found() from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{scenario_id}/duplicate", response_model=ScenarioOut, status_code=status.HTTP_201_CREATED
)
async def duplicate_scenario(
    scenario_id: uuid.UUID, principal: CurrentPrincipal, db: Db
) -> ScenarioOut:
    try:
        copy = await service.duplicate_scenario(db, scenario_id, created_by=principal.user.id)
    except ScenarioNotFound:
        raise _not_found() from None
    except ScenarioNameTaken:
        raise _name_taken() from None
    except ScenarioConflict:
        raise _conflict() from None
    return ScenarioOut.of(copy)
