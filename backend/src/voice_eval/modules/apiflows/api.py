"""HTTP API of API flows: `/api/apis/*` and `/api/flows/*` (behind authentication).

Written for agents first: every route says what it is for, and request models carry examples.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.agents.domain import AgentKind, InvalidAgentInput, check_base_url
from voice_eval.modules.apiflows import runs, service
from voice_eval.modules.apiflows.domain import (
    MAX_HEADERS,
    MAX_SECRET_LENGTH,
    MAX_SECRETS,
    MAX_VARIABLE_LENGTH,
    MAX_VARIABLES,
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
from voice_eval.modules.apiflows.runner import FlowInputError, GenerationError
from voice_eval.modules.apiflows.runs import FlowRunner
from voice_eval.modules.connections.domain import ConnectionNotFound, UnsupportedConnection
from voice_eval.modules.scenarios.domain import unique_tags
from voice_eval.modules.users.deps import Principal, current_principal
from voice_eval.platform.db import get_db_session
from voice_eval.platform.secrets import SecretBox, SecretDecryptionError, app_secret_box

Db = Annotated[AsyncSession, Depends(get_db_session)]
Box = Annotated[SecretBox, Depends(app_secret_box)]
CurrentPrincipal = Annotated[Principal, Depends(current_principal)]
SecretValue = Annotated[str, StringConstraints(min_length=1, max_length=MAX_SECRET_LENGTH)]
VariableValue = Annotated[str, StringConstraints(max_length=MAX_VARIABLE_LENGTH)]
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
    variables: dict[str, str] = Field(
        description="Plain connection variables by name; steps use them as {{var.<name>}}."
    )
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
            variables=api.variables,
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
    headers: Headers = Field(
        default=[], description="Headers every step sends (templates, like the steps' own)."
    )
    variables: Annotated[dict[Identifier, VariableValue], Field(max_length=MAX_VARIABLES)] = Field(
        default={},
        description="Plain connection variables. Steps use them as {{var.<name>}}.",
    )
    secrets: Annotated[dict[Identifier, SecretValue], Field(max_length=MAX_SECRETS)] = Field(
        default={},
        description="Named secrets, sealed at rest. Steps use them as {{var.<name>}} "
        "(or {{secret.<name>}}). A name is a variable or a secret, not both.",
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
    variables: (
        Annotated[dict[Identifier, VariableValue | None], Field(max_length=MAX_VARIABLES)] | None
    ) = Field(default=None, description="Sets the named variables; null removes one; others stay.")
    secrets: (
        Annotated[dict[Identifier, SecretValue | None], Field(max_length=MAX_SECRETS)] | None
    ) = Field(default=None, description="Sets the named secrets; null removes one; others stay.")

    _not_null = field_validator(
        "name", "description", "tags", "base_url", "headers", "variables", "secrets"
    )(_not_null)
    _check_base_url = field_validator("base_url")(_base_url)
    _unique_tags = field_validator("tags")(unique_tags)


class ApiSummaryOut(DomainModel):
    id: uuid.UUID
    name: str


class LastRunOut(DomainModel):
    id: uuid.UUID
    status: str
    created_at: datetime
    duration_ms: int


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
    last_run: LastRunOut | None = Field(description="The flow's newest run, if any.")

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
            last_run=LastRunOut(
                id=flow.last_run.id,
                status=flow.last_run.status,
                created_at=flow.last_run.created_at,
                duration_ms=flow.last_run.duration_ms,
            )
            if flow.last_run
            else None,
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
    except InvalidFlowInput as exc:
        raise _invalid(exc) from None
    return ApiOut.of(created)


@apis_router.get("/{api_id}", response_model=ApiOut, summary="Get an API")
async def get_api(api_id: uuid.UUID, db: Db) -> ApiOut:
    try:
        return ApiOut.of(await service.get_api(db, api_id))
    except ApiNotFound:
        raise _api_not_found() from None


@apis_router.patch("/{api_id}", response_model=ApiOut, summary="Update an API")
async def update_api(api_id: uuid.UUID, body: UpdateApiIn, db: Db, box: Box) -> ApiOut:
    """Only the fields sent change. `secrets` sets or (with null) removes single secrets; an API
    holds at most 10 (422 otherwise)."""
    try:
        updated = await service.update_api(
            db, box, api_id, changes={name: getattr(body, name) for name in body.model_fields_set}
        )
    except ApiNotFound:
        raise _api_not_found() from None
    except ApiNameTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "API name already in use") from None
    except InvalidFlowInput as exc:
        raise _invalid(exc) from None
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


# ---- Runs ----


class RunFlowIn(DomainModel):
    model_config = ConfigDict(
        json_schema_extra={"examples": [{"inputs": {"query": "king size linen"}}, {"inputs": {}}]}
    )

    inputs: Annotated[dict[str, str | int | float | bool | None], Field(max_length=50)] = Field(
        default={},
        description="Values by input name. Omitted inputs take their default; inputs with "
        "`generate` and no value are written by AI.",
    )
    ai_connection_id: uuid.UUID | None = Field(
        default=None,
        description="Chat connection that writes generated inputs (default: the first OpenAI or "
        "Azure OpenAI connection with a chat model, by name).",
    )


class ResolvedInputOut(DomainModel):
    name: str
    value: Any
    source: str = Field(description="given, default or generated")


class StepRunOut(DomainModel):
    index: int
    title: str
    status: str = Field(description="passed, failed or skipped (after a failed step)")
    request: dict[str, Any] | None = Field(
        description="method, url, headers and body as sent, secrets as {{secret.<name>}}."
    )
    response: dict[str, Any] | None = Field(
        description="status, headers, body (JSON when the API sent JSON; long bodies are "
        "truncated) and sizeBytes. Secret values echoed by the API appear as placeholders."
    )
    duration_ms: int | None
    saved: dict[str, Any] = Field(description="Values this step saved for later steps.")
    checks: list[dict[str, Any]] = Field(
        description="Each check, whether it passed, and the actual value."
    )
    error: str | None = Field(description="Why the step failed when it is not a check.")


class FlowRunOut(DomainModel):
    id: uuid.UUID
    flow_id: uuid.UUID
    status: str = Field(description="passed when every step passed, otherwise failed")
    inputs: list[ResolvedInputOut]
    steps: list[StepRunOut]
    duration_ms: int
    created_at: datetime

    @classmethod
    def of(cls, run: Any) -> "FlowRunOut":
        return cls(
            id=run.id,
            flow_id=run.flow_id,
            status=run.status,
            inputs=[ResolvedInputOut.model_validate(item) for item in run.inputs],
            steps=[StepRunOut.model_validate(step) for step in run.steps],
            duration_ms=run.duration_ms,
            created_at=run.created_at,
        )


class CurlOut(DomainModel):
    curl: str


class FlowCurlsOut(DomainModel):
    steps: list[CurlOut]


def _ai_error(msg: str) -> dict[str, Any]:
    return {"type": "value_error", "loc": ["aiConnectionId"], "msg": msg}


def flow_runner(request: Request) -> FlowRunner:
    return request.app.state.flow_runner


Runner = Annotated[FlowRunner, Depends(flow_runner)]
Reveal = Annotated[
    bool,
    Query(description="true: the API's secrets in clear; false: their masked hints."),
]
runs_router = APIRouter(prefix="/flow-runs", tags=["API flows"])


@flows_router.post(
    "/{flow_id}/runs",
    response_model=FlowRunOut,
    status_code=status.HTTP_201_CREATED,
    summary="Run a flow",
)
async def run_flow(
    flow_id: uuid.UUID, body: RunFlowIn, principal: CurrentPrincipal, db: Db, runner: Runner
) -> FlowRunOut:
    """Runs every step now (each has 30 s) and returns the whole trace: per step the request,
    the response, saved values and checks. The run stops at the first failed step. A failed run
    is still 201: read `status`, then the first step whose status is `failed`."""
    try:
        run = await runner.run(
            db,
            flow_id,
            inputs=body.inputs,
            connection_id=body.ai_connection_id,
            created_by=principal.user.id,
        )
    except FlowNotFound:
        raise _flow_not_found() from None
    except FlowInputError as exc:
        raise _invalid(InvalidFlowInput(exc.errors)) from None
    except ConnectionNotFound:
        raise _invalid(InvalidFlowInput([_ai_error("connection not found")])) from None
    except UnsupportedConnection as exc:
        raise _invalid(InvalidFlowInput([_ai_error(str(exc))])) from None
    except GenerationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from None
    except SecretDecryptionError:
        raise _undecryptable() from None
    return FlowRunOut.of(run)


@flows_router.get("/{flow_id}/runs", response_model=list[FlowRunOut], summary="List a flow's runs")
async def list_runs(
    flow_id: uuid.UUID, db: Db, limit: Annotated[int, Query(ge=1, le=50)] = 20
) -> list[FlowRunOut]:
    """Newest first."""
    try:
        return [FlowRunOut.of(run) for run in await runs.list_runs(db, flow_id, limit=limit)]
    except FlowNotFound:
        raise _flow_not_found() from None


@flows_router.get("/{flow_id}/curl", response_model=FlowCurlsOut, summary="A flow as cURL")
async def flow_curl(
    flow_id: uuid.UUID, db: Db, box: Box, request: Request, reveal: Reveal = False
) -> FlowCurlsOut:
    """Each step as a cURL command before running it. Query parameters other than `reveal` fill
    inputs by name (`?query=linen`); defaults fill the rest. Values only a run knows (saved
    values, AI-written inputs) stay as `{{…}}` placeholders."""
    inputs = {k: v for k, v in request.query_params.items() if k != "reveal"}
    try:
        commands = await runs.flow_curls(db, box, flow_id, inputs=inputs, reveal=reveal)
    except FlowNotFound:
        raise _flow_not_found() from None
    except SecretDecryptionError:
        raise _undecryptable() from None
    return FlowCurlsOut(steps=[CurlOut(curl=command) for command in commands])


class FlowRunSummaryOut(DomainModel):
    id: uuid.UUID
    flow_id: uuid.UUID
    flow_name: str
    api_id: uuid.UUID
    api_name: str
    status: str
    step_count: int
    duration_ms: int
    created_at: datetime


class FlowRunPageOut(DomainModel):
    items: list[FlowRunSummaryOut]
    total: int


@runs_router.get("", response_model=FlowRunPageOut, summary="List runs of every flow")
async def list_all_runs(
    db: Db,
    status_: Annotated[
        Literal["passed", "failed"] | None, Query(alias="status", description="passed or failed")
    ] = None,
    api_id: Annotated[uuid.UUID | None, Query(alias="apiId")] = None,
    flow_id: Annotated[uuid.UUID | None, Query(alias="flowId")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> FlowRunPageOut:
    """Every flow's runs, newest first, as summaries (read one with GET /api/flow-runs/{runId}
    for its steps)."""
    items, total = await runs.list_all_runs(
        db, status=status_, api_id=api_id, flow_id=flow_id, limit=limit, offset=offset
    )
    return FlowRunPageOut(
        items=[FlowRunSummaryOut.model_validate(item, from_attributes=True) for item in items],
        total=total,
    )


@runs_router.get("/{run_id}", response_model=FlowRunOut, summary="Get a flow run")
async def get_run(run_id: uuid.UUID, db: Db) -> FlowRunOut:
    try:
        return FlowRunOut.of(await runs.get_run(db, run_id))
    except runs.FlowRunNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found") from None


@runs_router.get(
    "/{run_id}/steps/{step}/curl", response_model=CurlOut, summary="A run step as cURL"
)
async def run_step_curl(
    run_id: uuid.UUID, step: int, db: Db, box: Box, reveal: Reveal = False
) -> CurlOut:
    """The request a step sent in that run, as a cURL command (`step` counts from 0)."""
    try:
        return CurlOut(curl=await runs.run_curl(db, box, run_id, step, reveal=reveal))
    except runs.FlowRunNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found") from None
    except runs.StepNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Step not found or not sent") from None
    except SecretDecryptionError:
        raise _undecryptable() from None
