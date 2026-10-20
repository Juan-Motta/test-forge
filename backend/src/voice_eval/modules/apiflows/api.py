"""HTTP API of API flows: `/api/apis/*` and `/api/flows/*` (behind authentication).

Written for agents first: every route says what it is for, and request models carry examples.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.agents.domain import AgentKind, InvalidAgentInput, check_base_url
from voice_eval.modules.apiflows import service
from voice_eval.modules.apiflows.domain import (
    MAX_HEADERS,
    MAX_SECRET_LENGTH,
    MAX_SECRETS,
    AgentRef,
    Api,
    ApiNameTaken,
    ApiNotEmpty,
    ApiNotFound,
    Description,
    DomainModel,
    Flow,
    FlowInput,
    FlowNameTaken,
    FlowNotFound,
    Header,
    Identifier,
    Inputs,
    InvalidFlowInput,
    Name,
    Step,
    Steps,
    Tags,
)
from voice_eval.modules.scenarios.domain import unique_tags
from voice_eval.modules.users.deps import Principal, current_principal
from voice_eval.platform.db import get_db_session
from voice_eval.platform.secrets import SecretBox, SecretDecryptionError, app_secret_box

Db = Annotated[AsyncSession, Depends(get_db_session)]
Box = Annotated[SecretBox, Depends(app_secret_box)]
CurrentPrincipal = Annotated[Principal, Depends(current_principal)]
SecretValue = Annotated[str, StringConstraints(min_length=1, max_length=MAX_SECRET_LENGTH)]
Headers = Annotated[list[Header], Field(max_length=MAX_HEADERS)]

API_EXAMPLE = {
    "name": "Vivi Shop API",
    "description": "The shop behind the hotel concierge: catalog, carts and orders.",
    "tags": ["shop"],
    "baseUrl": "https://api.vivi-shop.example/v1",
    "headers": [{"name": "Accept", "value": "application/json"}],
    "secrets": {"api_key": "sk_live_…"},
}
FLOW_EXAMPLE = {
    "apiId": "6f1c2a52-8a4e-4c1b-9d55-0a7f0c1f9e10",
    "name": "Product search",
    "description": "Gets a JWT with the API key, then searches the catalog.",
    "inputs": [
        {
            "name": "query",
            "type": "text",
            "description": "What to search for",
            "generate": "A product a hotel guest would ask the shop for, in 2-4 words",
        },
        {"name": "max_price", "type": "number", "default": "120"},
    ],
    "steps": [
        {
            "title": "Get a JWT",
            "method": "POST",
            "path": "/auth/token",
            "headers": [{"name": "x-api-key", "value": "{{secret.api_key}}"}],
            "body": {"scope": "catalog:read"},
            "saves": [{"name": "token", "path": "body.access_token"}],
            "checks": [{"type": "status", "equals": 200}],
        },
        {
            "title": "Search the catalog",
            "method": "GET",
            "path": "/products/search",
            "query": [
                {"name": "q", "value": "{{input.query}}"},
                {"name": "max_price", "value": "{{input.max_price}}"},
                {"name": "limit", "value": "10"},
            ],
            "headers": [{"name": "Authorization", "value": "Bearer {{saved.token}}"}],
            "checks": [
                {"type": "status", "equals": 200},
                {"type": "path", "path": "body.items.length", "op": ">", "value": 0},
                {"type": "duration", "maxMs": 2000},
            ],
        },
    ],
    "agentIds": [],
}


class AgentRefOut(DomainModel):
    id: uuid.UUID
    name: str

    @classmethod
    def of(cls, agent: AgentRef) -> "AgentRefOut":
        return cls(id=agent.id, name=agent.name)


class SecretOut(DomainModel):
    name: str
    hint: str = Field(description="A mask and, for values of 8+ characters, the last 4.")


class ApiOut(DomainModel):
    id: uuid.UUID
    name: str
    description: str
    tags: list[str]
    base_url: str
    headers: list[Header]
    secrets: list[SecretOut] = Field(
        description="Names and masked hints only; GET /api/apis/{apiId}/secrets reveals values."
    )
    flow_count: int
    agents: list[AgentRefOut] = Field(description="Agents linked to at least one of its flows.")
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, api: Api) -> "ApiOut":
        return cls(
            id=api.id,
            name=api.name,
            description=api.description,
            tags=api.tags,
            base_url=api.base_url,
            headers=api.headers,
            secrets=[SecretOut(name=s.name, hint=s.hint) for s in api.secrets],
            flow_count=api.flow_count,
            agents=[AgentRefOut.of(agent) for agent in api.agents],
            created_at=api.created_at,
            updated_at=api.updated_at,
        )


class RevealedSecretsOut(DomainModel):
    secrets: dict[str, str] = Field(description="Every secret of the API, by name, in clear.")


def _base_url(value: str) -> str:
    try:
        return check_base_url(value, AgentKind.TEXT)
    except InvalidAgentInput as exc:
        raise ValueError(exc.errors[0]["msg"]) from None


def _not_null(value: Any) -> Any:
    if value is None:
        raise ValueError("may be omitted but not null")
    return value


class CreateApiIn(DomainModel):
    model_config = ConfigDict(json_schema_extra={"examples": [API_EXAMPLE]})

    name: Name
    description: Description = ""
    tags: Tags = []
    base_url: str = Field(
        description="https://…, or http:// to localhost, 127.0.0.1 or host.docker.internal. "
        "No query string; steps add their path to it."
    )
    headers: Headers = Field(default=[], description="Plain headers every step sends.")
    secrets: Annotated[dict[Identifier, SecretValue], Field(max_length=MAX_SECRETS)] = Field(
        default={},
        description="Named secrets, sealed at rest. Steps use them as {{secret.<name>}}.",
    )

    _check_base_url = field_validator("base_url")(_base_url)
    _unique_tags = field_validator("tags")(unique_tags)


class UpdateApiIn(DomainModel):
    """Partial update: only the fields present change; none of them may be null."""

    model_config = ConfigDict(
        json_schema_extra={"examples": [{"secrets": {"api_key": "sk_new…", "old_key": None}}]}
    )

    name: Name | None = None
    description: Description | None = None
    tags: Tags | None = None
    base_url: str | None = None
    headers: Headers | None = None
    secrets: (
        Annotated[dict[Identifier, SecretValue | None], Field(max_length=MAX_SECRETS)] | None
    ) = Field(default=None, description="Sets the named secrets; null removes one; others stay.")

    _not_null = field_validator("name", "description", "tags", "base_url", "headers", "secrets")(
        _not_null
    )
    _check_base_url = field_validator("base_url")(_base_url)
    _unique_tags = field_validator("tags")(unique_tags)


class ApiSummaryOut(DomainModel):
    id: uuid.UUID
    name: str


class FlowOut(DomainModel):
    id: uuid.UUID
    api_id: uuid.UUID
    api: ApiSummaryOut
    name: str
    description: str
    inputs: list[FlowInput]
    steps: list[Step]
    agents: list[AgentRefOut]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, flow: Flow) -> "FlowOut":
        return cls(
            id=flow.id,
            api_id=flow.api.id,
            api=ApiSummaryOut(id=flow.api.id, name=flow.api.name),
            name=flow.name,
            description=flow.description,
            inputs=flow.inputs,
            steps=flow.steps,
            agents=[AgentRefOut.of(agent) for agent in flow.agents],
            created_at=flow.created_at,
            updated_at=flow.updated_at,
        )


class CreateFlowIn(DomainModel):
    model_config = ConfigDict(json_schema_extra={"examples": [FLOW_EXAMPLE]})

    api_id: uuid.UUID
    name: Name
    description: Description = Field(
        default="", description="What the flow is for; agents read it to decide when to use it."
    )
    inputs: Inputs = []
    steps: Steps
    agent_ids: Annotated[list[uuid.UUID], Field(max_length=50)] = Field(
        default=[], description="Agents this flow is meant for (GET /api/flows?agentId=…)."
    )


class UpdateFlowIn(DomainModel):
    """Partial update: only the fields present change. `steps` and `inputs` are replaced whole."""

    api_id: uuid.UUID | None = None
    name: Name | None = None
    description: Description | None = None
    inputs: Inputs | None = None
    steps: Steps | None = None
    agent_ids: Annotated[list[uuid.UUID], Field(max_length=50)] | None = None

    _not_null = field_validator("api_id", "name", "description", "inputs", "steps", "agent_ids")(
        _not_null
    )


def _invalid(exc: InvalidFlowInput) -> HTTPException:
    """Same `{type, loc, msg}` items as request validation errors (see `platform.app`)."""
    detail = [{**error, "loc": ["body", *error["loc"]]} for error in exc.errors]
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def _api_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "API not found")


def _flow_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Flow not found")


def _undecryptable() -> HTTPException:
    return HTTPException(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "The API's stored secrets cannot be decrypted (wrong VOICE_EVAL_MASTER_KEY?)",
    )


apis_router = APIRouter(prefix="/apis", tags=["API flows"])
flows_router = APIRouter(prefix="/flows", tags=["API flows"])


@apis_router.get("", response_model=list[ApiOut], summary="List APIs")
async def list_apis(db: Db) -> list[ApiOut]:
    """Every API, alphabetically, with its flow count and the agents its flows are meant for."""
    return [ApiOut.of(api) for api in await service.list_apis(db)]


@apis_router.post(
    "", response_model=ApiOut, status_code=status.HTTP_201_CREATED, summary="Create an API"
)
async def create_api(body: CreateApiIn, principal: CurrentPrincipal, db: Db, box: Box) -> ApiOut:
    """An API: a base URL, plain headers and named secrets that its flows' steps use.
    Names are unique (409 otherwise)."""
    try:
        created = await service.create_api(db, box, fields=dict(body), created_by=principal.user.id)
    except ApiNameTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "API name already in use") from None
    return ApiOut.of(created)


@apis_router.get("/{api_id}", response_model=ApiOut, summary="Get an API")
async def get_api(api_id: uuid.UUID, db: Db) -> ApiOut:
    try:
        return ApiOut.of(await service.get_api(db, api_id))
    except ApiNotFound:
        raise _api_not_found() from None


@apis_router.patch("/{api_id}", response_model=ApiOut, summary="Update an API")
async def update_api(api_id: uuid.UUID, body: UpdateApiIn, db: Db, box: Box) -> ApiOut:
    """Only the fields sent change. `secrets` sets or (with null) removes single secrets."""
    try:
        updated = await service.update_api(
            db, box, api_id, changes={name: getattr(body, name) for name in body.model_fields_set}
        )
    except ApiNotFound:
        raise _api_not_found() from None
    except ApiNameTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "API name already in use") from None
    except SecretDecryptionError:
        raise _undecryptable() from None
    return ApiOut.of(updated)


@apis_router.get(
    "/{api_id}/secrets", response_model=RevealedSecretsOut, summary="Reveal an API's secrets"
)
async def reveal_secrets(api_id: uuid.UUID, db: Db, box: Box) -> RevealedSecretsOut:
    """The secrets in clear, for a person or agent that needs to see or use them. Everything
    else returns masked hints; do not print these values where they are not needed."""
    try:
        return RevealedSecretsOut(secrets=await service.reveal_secrets(db, box, api_id))
    except ApiNotFound:
        raise _api_not_found() from None
    except SecretDecryptionError:
        raise _undecryptable() from None


@apis_router.delete(
    "/{api_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete an empty API"
)
async def delete_api(api_id: uuid.UUID, db: Db) -> Response:
    """Only an API without flows can be deleted (409 otherwise)."""
    try:
        await service.delete_api(db, api_id)
    except ApiNotFound:
        raise _api_not_found() from None
    except ApiNotEmpty as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"API holds {exc.flow_count} flow(s); move or delete them first",
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@flows_router.get("", response_model=list[FlowOut], summary="List flows")
async def list_flows(
    db: Db,
    api_id: Annotated[uuid.UUID | None, Query(alias="apiId")] = None,
    agent_id: Annotated[
        uuid.UUID | None,
        Query(alias="agentId", description="Only the flows meant for this agent."),
    ] = None,
) -> list[FlowOut]:
    """Flows alphabetically, each with its inputs and steps: read them to learn what an API can
    do and how to call it, then run one instead of writing a script."""
    return [FlowOut.of(f) for f in await service.list_flows(db, api_id=api_id, agent_id=agent_id)]


@flows_router.post(
    "", response_model=FlowOut, status_code=status.HTTP_201_CREATED, summary="Create a flow"
)
async def create_flow(body: CreateFlowIn, principal: CurrentPrincipal, db: Db) -> FlowOut:
    """A flow is one or more steps (HTTP calls) against its API. Text in a step may use
    `{{input.<name>}}`, `{{secret.<name>}}` and `{{saved.<name>}}` (a value an earlier step
    saved). Unknown references are rejected with the field's location (422). Names are unique
    within an API (409)."""
    try:
        created = await service.create_flow(db, fields=dict(body), created_by=principal.user.id)
    except InvalidFlowInput as exc:
        raise _invalid(exc) from None
    except FlowNameTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Flow name already in use") from None
    return FlowOut.of(created)


@flows_router.get("/{flow_id}", response_model=FlowOut, summary="Get a flow")
async def get_flow(flow_id: uuid.UUID, db: Db) -> FlowOut:
    try:
        return FlowOut.of(await service.get_flow(db, flow_id))
    except FlowNotFound:
        raise _flow_not_found() from None


@flows_router.patch("/{flow_id}", response_model=FlowOut, summary="Update a flow")
async def update_flow(flow_id: uuid.UUID, body: UpdateFlowIn, db: Db) -> FlowOut:
    """Only the fields sent change; `inputs`, `steps` and `agentIds` are replaced whole."""
    try:
        updated = await service.update_flow(
            db, flow_id, changes={name: getattr(body, name) for name in body.model_fields_set}
        )
    except FlowNotFound:
        raise _flow_not_found() from None
    except InvalidFlowInput as exc:
        raise _invalid(exc) from None
    except FlowNameTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Flow name already in use") from None
    return FlowOut.of(updated)


@flows_router.delete("/{flow_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a flow")
async def delete_flow(flow_id: uuid.UUID, db: Db) -> Response:
    try:
        await service.delete_flow(db, flow_id)
    except FlowNotFound:
        raise _flow_not_found() from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
