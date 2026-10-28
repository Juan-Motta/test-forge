"""HTTP API of the agents module: `/api/agents/*` (behind authentication)."""

import uuid
from datetime import datetime
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    StringConstraints,
    field_validator,
)
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.agents import service
from voice_eval.modules.agents.connection_check import check_connection, check_text_connection
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
    AgentKind,
    AgentNameTaken,
    AgentNotFound,
    AgentProtocol,
    InvalidAgentInput,
    TextAuth,
    TextMode,
    check_origin,
    check_user_id,
)
from voice_eval.modules.users.deps import Principal, current_principal
from voice_eval.platform.db import get_db_session
from voice_eval.platform.secrets import SecretBox, SecretDecryptionError, app_secret_box

Db = Annotated[AsyncSession, Depends(get_db_session)]
Box = Annotated[SecretBox, Depends(app_secret_box)]
MAX_API_KEY_LENGTH = 512

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
SessionUrl = Annotated[str, StringConstraints(max_length=MAX_URL_LENGTH + 64)]  # by service
ApiKey = Annotated[SecretStr, Field(min_length=1, max_length=MAX_API_KEY_LENGTH)]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StrictCamelModel(CamelModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class AgentOut(CamelModel):
    id: uuid.UUID
    name: str
    kind: AgentKind
    context: str
    protocol: AgentProtocol
    base_url: str
    channel_id: str
    user_id: str | None  # voice agents only, except relay ones
    session_url: str | None  # relay agents only
    text_mode: TextMode | None  # text agents only
    auth: TextAuth | None  # text agents only
    has_api_key: bool  # the key itself is write-only
    api_key_hint: str | None
    origin: str | None
    langfuse_connection_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, agent: Agent) -> "AgentOut":
        return cls(
            id=agent.id,
            name=agent.name,
            kind=agent.kind,
            context=agent.context,
            protocol=agent.protocol,
            base_url=agent.base_url,
            channel_id=agent.channel_id,
            user_id=agent.user_id,
            session_url=agent.session_url,
            text_mode=agent.text_mode,
            auth=agent.auth,
            has_api_key=agent.has_api_key,
            api_key_hint=agent.api_key_hint,
            origin=agent.origin,
            langfuse_connection_id=agent.langfuse_connection_id,
            created_at=agent.created_at,
            updated_at=agent.updated_at,
        )


class CreateIn(StrictCamelModel):
    """`kind` decides the other fields. Voice agents need `channelId` and `userId` (`protocol`
    defaults to `auto`), except `relay` ones, which may give a `sessionUrl` instead. Text agents
    take `textMode` (default `stream`), `auth` (default `none`) and, with `auth: api_key`, the
    write-only `apiKey`."""

    name: Name
    kind: AgentKind = AgentKind.VOICE
    context: Context = ""
    protocol: AgentProtocol | None = None
    base_url: BaseUrl
    channel_id: ChannelId | None = None
    user_id: UserId | None = None
    session_url: SessionUrl | None = None
    text_mode: TextMode | None = None
    auth: TextAuth | None = None
    api_key: ApiKey | None = None
    origin: Origin | None = None
    langfuse_connection_id: uuid.UUID | None = None


class UpdateIn(StrictCamelModel):
    """Partial update: only the fields present are changed; `null` clears an optional field.

    `kind` cannot change. `apiKey` replaces the stored key; `auth: none` removes it."""

    name: Name | None = None
    kind: AgentKind | None = None
    context: Context | None = None
    protocol: AgentProtocol | None = None
    base_url: BaseUrl | None = None
    channel_id: ChannelId | None = None
    user_id: UserId | None = None
    session_url: SessionUrl | None = None
    text_mode: TextMode | None = None
    auth: TextAuth | None = None
    api_key: ApiKey | None = None
    origin: Origin | None = None
    langfuse_connection_id: uuid.UUID | None = None

    @field_validator("name", "kind", "context", "protocol", "base_url", "channel_id")
    @classmethod
    def required_when_present(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("may be omitted but not null")
        return value


class ConnectionLogLineOut(CamelModel):
    ok: bool
    message: str


class ConnectionTestOut(CamelModel):
    reachable: bool  # voice: the session became ready; text: the test message was answered
    latency_ms: int | None  # voice: connect + ready; text: the whole reply; when reachable
    protocol: str | None  # voice: "live", "realtime" or "relay" once known; text: always null
    log: list[ConnectionLogLineOut]


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


def text_transport() -> httpx.AsyncBaseTransport | None:
    """The HTTP transport of text connection tests: None, the egress-guarded default (tests
    override it with an in-process fake)."""
    return None


router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentOut])
async def list_agents(db: Db) -> list[AgentOut]:
    return [AgentOut.of(agent) for agent in await service.list_agents(db)]


@router.post("", response_model=AgentOut, status_code=status.HTTP_201_CREATED)
async def create_agent(
    body: CreateIn,
    principal: Annotated[Principal, Depends(current_principal)],
    db: Db,
    box: Box,
) -> AgentOut:
    try:
        created = await service.create_agent(
            db,
            box,
            fields=body.model_dump(),
            created_by=principal.user.id,
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
async def update_agent(agent_id: uuid.UUID, body: UpdateIn, db: Db, box: Box) -> AgentOut:
    try:
        updated = await service.update_agent(
            db,
            box,
            agent_id,
            changes=body.model_dump(exclude_unset=True),
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


@router.post("/{agent_id}/test", response_model=ConnectionTestOut)
async def test_agent(
    agent_id: uuid.UUID,
    request: Request,
    db: Db,
    box: Box,
    transport: Annotated[httpx.AsyncBaseTransport | None, Depends(text_transport)],
) -> ConnectionTestOut:
    """Check that the agent answers. Voice: open a live session with the agent, wait until it is
    ready, then close it (no audio is sent). Text: send one short message ("Hello, this is a
    connection test.") in a fresh conversation and wait for the whole reply; this reaches the
    agent, which answers it. Unreachable agents answer `200` with `reachable: false` and the
    failing step; the log never includes what the agent answered."""
    try:
        agent = await service.get_agent(db, agent_id)
        api_key = (
            await service.agent_api_key(db, box, agent_id) if agent.kind == AgentKind.TEXT else None
        )
    except AgentNotFound:
        raise _not_found() from None
    except SecretDecryptionError:
        message = "The stored API key cannot be decrypted (wrong VOICE_EVAL_MASTER_KEY?)"
        return ConnectionTestOut(
            reachable=False,
            latency_ms=None,
            protocol=None,
            log=[ConnectionLogLineOut(ok=False, message=message)],
        )
    await db.close()  # release the connection while the agent is dialled
    settings = request.app.state.settings
    if agent.kind == AgentKind.TEXT:
        check = await check_text_connection(
            agent,
            api_key,
            local_target_host=settings.local_target_host,
            allow_private=settings.environment == "development",
            transport=transport,
        )
    else:
        check = await check_connection(agent, local_target_host=settings.local_target_host)
    return ConnectionTestOut(
        reachable=check.reachable,
        latency_ms=check.latency_ms,
        protocol=check.protocol,
        log=[ConnectionLogLineOut(ok=line.ok, message=line.message) for line in check.log],
    )
