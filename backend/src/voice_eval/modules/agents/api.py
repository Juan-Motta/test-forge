"""HTTP API of the agents module: `/api/agents/*` (behind authentication)."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints, field_validator
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.agents import service
from voice_eval.modules.agents.domain import (
    CHANNEL_ID_PATTERN,
    MAX_CHANNEL_ID_LENGTH,
    MAX_CONTEXT_LENGTH,
    MAX_NAME_LENGTH,
    MAX_ORIGIN_LENGTH,
    MAX_URL_LENGTH,
    MAX_USER_ID_LENGTH,
    Agent,
    AgentConflict,
    AgentInUse,
    AgentNameTaken,
    AgentNotFound,
    AgentProtocol,
    InvalidAgentInput,
    check_origin,
    check_user_id,
)
from voice_eval.modules.users.deps import Principal, current_principal
from voice_eval.platform.db import get_db_session
from voice_eval.platform.settings import Settings, app_settings

Db = Annotated[AsyncSession, Depends(get_db_session)]
AppSettings = Annotated[Settings, Depends(app_settings)]

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME_LENGTH)
]
Context = Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_CONTEXT_LENGTH)]
BaseUrl = Annotated[str, StringConstraints(max_length=MAX_URL_LENGTH + 64)]  # checked by service
ChannelId = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_CHANNEL_ID_LENGTH,
        pattern=CHANNEL_ID_PATTERN,
    ),
]
UserId = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_USER_ID_LENGTH),
    AfterValidator(check_user_id),
]
Origin = Annotated[
    str, StringConstraints(max_length=MAX_ORIGIN_LENGTH), AfterValidator(check_origin)
]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StrictCamelModel(CamelModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class AgentOut(CamelModel):
    id: uuid.UUID
    name: str
    context: str
    protocol: AgentProtocol
    base_url: str
    channel_id: str
    user_id: str
    origin: str | None
    langfuse_connection_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, agent: Agent) -> "AgentOut":
        return cls(
            id=agent.id,
            name=agent.name,
            context=agent.context,
            protocol=agent.protocol,
            base_url=agent.base_url,
            channel_id=agent.channel_id,
            user_id=agent.user_id,
            origin=agent.origin,
            langfuse_connection_id=agent.langfuse_connection_id,
            created_at=agent.created_at,
            updated_at=agent.updated_at,
        )


class CreateIn(StrictCamelModel):
    name: Name
    context: Context = ""
    protocol: AgentProtocol = AgentProtocol.AUTO
    base_url: BaseUrl
    channel_id: ChannelId
    user_id: UserId
    origin: Origin | None = None
    langfuse_connection_id: uuid.UUID | None = None


class UpdateIn(StrictCamelModel):
    """Partial update: only the fields present are changed; `null` clears an optional field."""

    name: Name | None = None
    context: Context | None = None
    protocol: AgentProtocol | None = None
    base_url: BaseUrl | None = None
    channel_id: ChannelId | None = None
    user_id: UserId | None = None
    origin: Origin | None = None
    langfuse_connection_id: uuid.UUID | None = None

    @field_validator("name", "context", "protocol", "base_url", "channel_id", "user_id")
    @classmethod
    def required_when_present(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("may be omitted but not null")
        return value


def _invalid(exc: InvalidAgentInput) -> HTTPException:
    """Same `{type, loc, msg}` items as request validation errors (see `platform.app`)."""
    detail = [
        {"type": error["type"], "loc": ["body", *error["loc"]], "msg": error["msg"]}
        for error in exc.errors
    ]
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def _name_taken() -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "Agent name already in use")


def _conflict() -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT, "Agent conflicts with a concurrent change; try again"
    )


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found")


def _local_ws(settings: Settings) -> bool:
    return settings.environment == "development"


router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentOut])
async def list_agents(db: Db) -> list[AgentOut]:
    return [AgentOut.of(agent) for agent in await service.list_agents(db)]


@router.post("", response_model=AgentOut, status_code=status.HTTP_201_CREATED)
async def create_agent(
    body: CreateIn,
    principal: Annotated[Principal, Depends(current_principal)],
    db: Db,
    settings: AppSettings,
) -> AgentOut:
    try:
        created = await service.create_agent(
            db,
            fields=body.model_dump(),
            created_by=principal.user.id,
            allow_local_ws=_local_ws(settings),
        )
    except InvalidAgentInput as exc:
        raise _invalid(exc) from None
    except AgentNameTaken:
        raise _name_taken() from None
    except AgentConflict:
        raise _conflict() from None
    return AgentOut.of(created)


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(agent_id: uuid.UUID, db: Db) -> AgentOut:
    try:
        return AgentOut.of(await service.get_agent(db, agent_id))
    except AgentNotFound:
        raise _not_found() from None


@router.patch("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: uuid.UUID, body: UpdateIn, db: Db, settings: AppSettings
) -> AgentOut:
    try:
        updated = await service.update_agent(
            db,
            agent_id,
            changes=body.model_dump(exclude_unset=True),
            allow_local_ws=_local_ws(settings),
        )
    except AgentNotFound:
        raise _not_found() from None
    except InvalidAgentInput as exc:
        raise _invalid(exc) from None
    except AgentNameTaken:
        raise _name_taken() from None
    except AgentConflict:
        raise _conflict() from None
    return AgentOut.of(updated)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(agent_id: uuid.UUID, db: Db) -> Response:
    try:
        await service.delete_agent(db, agent_id)
    except AgentNotFound:
        raise _not_found() from None
    except AgentInUse as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Agent is used by {exc.scenarios} scenario(s)"
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
