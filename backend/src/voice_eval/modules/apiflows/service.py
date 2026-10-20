"""Use cases of APIs and their flows.

An API's secrets are sealed together with the `SecretBox` (owner: the API). Responses carry
hints only; `reveal_secrets` opens them on purpose, for the human or agent that asks.
"""

import uuid
from typing import Any

from sqlalchemy import delete, func, insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.agents.models import AgentRecord
from voice_eval.modules.apiflows.domain import (
    MAX_SECRETS,
    AgentRef,
    Api,
    ApiNameTaken,
    ApiNotEmpty,
    ApiNotFound,
    ApiSummary,
    Flow,
    FlowInput,
    FlowNameTaken,
    FlowNotFound,
    Header,
    InvalidFlowInput,
    SecretInfo,
    Step,
    check_flow,
    secret_hint,
)
from voice_eval.modules.apiflows.models import (
    API_NAME_UNIQUE_CONSTRAINT,
    FLOW_NAME_UNIQUE_CONSTRAINT,
    ApiRecord,
    FlowRecord,
    flow_agents,
)
from voice_eval.platform.secrets import SecretBox

SECRETS_KIND = "api-secrets"


def _constraint(exc: IntegrityError) -> str | None:
    return getattr(getattr(exc.orig, "__cause__", None), "constraint_name", None)


# ---- APIs ----


def _api(record: ApiRecord, flow_count: int = 0, agents: list[AgentRef] | None = None) -> Api:
    return Api(
        id=record.id,
        name=record.name,
        description=record.description,
        tags=list(record.tags),
        base_url=record.base_url,
        headers=[Header.model_validate(header) for header in record.headers],
        secrets=[SecretInfo(name, hint) for name, hint in sorted(record.secret_hints.items())],
        created_at=record.created_at,
        updated_at=record.updated_at,
        flow_count=flow_count,
        agents=agents or [],
    )


async def _with_counts(db: AsyncSession, records: list[ApiRecord]) -> list[Api]:
    ids = [record.id for record in records]
    counts = dict(
        (
            await db.execute(
                select(FlowRecord.api_id, func.count())
                .where(FlowRecord.api_id.in_(ids))
                .group_by(FlowRecord.api_id)
            )
        ).all()
    )
    agents: dict[uuid.UUID, list[AgentRef]] = {}
    for api_id, agent_id, agent_name in await db.execute(
        select(FlowRecord.api_id, AgentRecord.id, AgentRecord.name)
        .join(flow_agents, flow_agents.c.flow_id == FlowRecord.id)
        .join(AgentRecord, AgentRecord.id == flow_agents.c.agent_id)
        .where(FlowRecord.api_id.in_(ids))
        .distinct()
        .order_by(AgentRecord.name)
    ):
        agents.setdefault(api_id, []).append(AgentRef(agent_id, agent_name))
    return [_api(record, counts.get(record.id, 0), agents.get(record.id)) for record in records]


async def _fetch_api(db: AsyncSession, api_id: uuid.UUID) -> ApiRecord:
    record = await db.get(ApiRecord, api_id, populate_existing=True)
    if record is None:
        raise ApiNotFound(str(api_id))
    return record


async def _commit_api(db: AsyncSession) -> None:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if _constraint(exc) == API_NAME_UNIQUE_CONSTRAINT:
            raise ApiNameTaken() from None
        raise


async def _ensure_api_name_free(
    db: AsyncSession, name: str, *, besides: uuid.UUID | None = None
) -> None:
    query = select(ApiRecord.id).where(ApiRecord.name == name)
    if besides is not None:
        query = query.where(ApiRecord.id != besides)
    if await db.scalar(query):
        raise ApiNameTaken()


def _store_secrets(box: SecretBox, record: ApiRecord, secrets: dict[str, str]) -> None:
    record.secrets_ciphertext = (
        box.seal(secrets, owner=record.id, kind=SECRETS_KIND) if secrets else None
    )
    record.secret_hints = {name: secret_hint(value) for name, value in secrets.items()}


def open_secrets(box: SecretBox, record: ApiRecord) -> dict[str, str]:
    if record.secrets_ciphertext is None:
        return {}
    return box.open(record.secrets_ciphertext, owner=record.id, kind=SECRETS_KIND)


async def list_apis(db: AsyncSession) -> list[Api]:
    records = list(await db.scalars(select(ApiRecord).order_by(ApiRecord.name)))
    return await _with_counts(db, records)


async def get_api(db: AsyncSession, api_id: uuid.UUID) -> Api:
    return (await _with_counts(db, [await _fetch_api(db, api_id)]))[0]


async def create_api(
    db: AsyncSession, box: SecretBox, *, fields: dict[str, Any], created_by: uuid.UUID | None
) -> Api:
    await _ensure_api_name_free(db, fields["name"])
    record = ApiRecord(
        id=uuid.uuid4(),
        name=fields["name"],
        description=fields.get("description", ""),
        tags=fields.get("tags", []),
        base_url=fields["base_url"],
        headers=[header.model_dump() for header in fields.get("headers", [])],
        created_by=created_by,
    )
    _store_secrets(box, record, fields.get("secrets") or {})
    db.add(record)
    await _commit_api(db)
    return await get_api(db, record.id)


async def update_api(
    db: AsyncSession, box: SecretBox, api_id: uuid.UUID, *, changes: dict[str, Any]
) -> Api:
    """`secrets` maps a name to a new value, or to None to remove it; names left out are kept."""
    record = await _fetch_api(db, api_id)
    if "name" in changes and changes["name"] != record.name:
        await _ensure_api_name_free(db, changes["name"], besides=record.id)
    for key in ("name", "description", "tags", "base_url"):
        if key in changes:
            setattr(record, key, changes[key])
    if "headers" in changes:
        record.headers = [header.model_dump() for header in changes["headers"]]
    if "secrets" in changes:
        secrets = open_secrets(box, record)
        for name, value in changes["secrets"].items():
            if value is None:
                secrets.pop(name, None)
            else:
                secrets[name] = value
        if len(secrets) > MAX_SECRETS:
            raise InvalidFlowInput(
                [
                    {
                        "type": "value_error",
                        "loc": ["secrets"],
                        "msg": f"an API holds at most {MAX_SECRETS} secrets",
                    }
                ]
            )
        _store_secrets(box, record, secrets)
    record.updated_at = func.now()
    await _commit_api(db)
    return await get_api(db, api_id)


async def reveal_secrets(db: AsyncSession, box: SecretBox, api_id: uuid.UUID) -> dict[str, str]:
    """The API's secrets in clear. Only for an explicit request to see them."""
    return open_secrets(box, await _fetch_api(db, api_id))


async def delete_api(db: AsyncSession, api_id: uuid.UUID) -> None:
    record = await _fetch_api(db, api_id)
    count = await _flow_count(db, api_id)
    if count:
        raise ApiNotEmpty(count)
    await db.delete(record)
    try:
        await db.commit()
    except IntegrityError:
        # A flow landed in the API meanwhile: the RESTRICT foreign key kept it.
        await db.rollback()
        raise ApiNotEmpty(await _flow_count(db, api_id)) from None


async def _flow_count(db: AsyncSession, api_id: uuid.UUID) -> int:
    return await db.scalar(select(func.count()).where(FlowRecord.api_id == api_id)) or 0


# ---- Flows ----


def _flow(record: FlowRecord) -> Flow:
    return Flow(
        id=record.id,
        api=ApiSummary(record.api.id, record.api.name),
        name=record.name,
        description=record.description,
        inputs=[FlowInput.model_validate(item) for item in record.inputs],
        steps=[Step.model_validate(item) for item in record.steps],
        agents=[AgentRef(agent.id, agent.name) for agent in record.agents],
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


async def _fetch_flow(db: AsyncSession, flow_id: uuid.UUID) -> FlowRecord:
    record = await db.get(FlowRecord, flow_id, populate_existing=True)
    if record is None:
        raise FlowNotFound(str(flow_id))
    return record


async def list_flows(
    db: AsyncSession, *, api_id: uuid.UUID | None = None, agent_id: uuid.UUID | None = None
) -> list[Flow]:
    query = select(FlowRecord).order_by(FlowRecord.name)
    if api_id is not None:
        query = query.where(FlowRecord.api_id == api_id)
    if agent_id is not None:
        query = query.where(
            FlowRecord.id.in_(
                select(flow_agents.c.flow_id).where(flow_agents.c.agent_id == agent_id)
            )
        )
    return [_flow(record) for record in await db.scalars(query)]


async def get_flow(db: AsyncSession, flow_id: uuid.UUID) -> Flow:
    return _flow(await _fetch_flow(db, flow_id))


async def _validate(
    db: AsyncSession, api: ApiRecord, inputs: list[FlowInput], steps: list[Step], agent_ids: Any
) -> list[uuid.UUID] | None:
    errors = check_flow(inputs, steps, set(api.secret_hints))
    agents: list[uuid.UUID] | None = None
    if agent_ids is not None:
        agents = list(dict.fromkeys(agent_ids))
        known = set(await db.scalars(select(AgentRecord.id).where(AgentRecord.id.in_(agents))))
        errors += [
            {"type": "value_error", "loc": ["agentIds", i], "msg": "agent not found"}
            for i, agent_id in enumerate(agents)
            if agent_id not in known
        ]
    if errors:
        raise InvalidFlowInput(errors)
    return agents


async def _set_agents(db: AsyncSession, flow_id: uuid.UUID, agent_ids: list[uuid.UUID]) -> None:
    await db.execute(delete(flow_agents).where(flow_agents.c.flow_id == flow_id))
    if agent_ids:
        await db.execute(
            insert(flow_agents), [{"flow_id": flow_id, "agent_id": a} for a in agent_ids]
        )


async def _commit_flow(db: AsyncSession) -> None:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if _constraint(exc) == FLOW_NAME_UNIQUE_CONSTRAINT:
            raise FlowNameTaken() from None
        raise


async def _ensure_flow_name_free(
    db: AsyncSession, api_id: uuid.UUID, name: str, *, besides: uuid.UUID | None = None
) -> None:
    query = select(FlowRecord.id).where(FlowRecord.api_id == api_id, FlowRecord.name == name)
    if besides is not None:
        query = query.where(FlowRecord.id != besides)
    if await db.scalar(query):
        raise FlowNameTaken()


async def _api_for_flow(db: AsyncSession, api_id: uuid.UUID) -> ApiRecord:
    record = await db.get(ApiRecord, api_id)
    if record is None:
        raise InvalidFlowInput([{"type": "value_error", "loc": ["apiId"], "msg": "API not found"}])
    return record


async def create_flow(
    db: AsyncSession, *, fields: dict[str, Any], created_by: uuid.UUID | None
) -> Flow:
    api = await _api_for_flow(db, fields["api_id"])
    agents = await _validate(db, api, fields["inputs"], fields["steps"], fields.get("agent_ids"))
    await _ensure_flow_name_free(db, api.id, fields["name"])
    record = FlowRecord(
        id=uuid.uuid4(),
        api_id=api.id,
        name=fields["name"],
        description=fields.get("description", ""),
        inputs=[item.model_dump(mode="json") for item in fields["inputs"]],
        steps=[step.model_dump(mode="json") for step in fields["steps"]],
        created_by=created_by,
    )
    db.add(record)
    await db.flush()
    await _set_agents(db, record.id, agents or [])
    await _commit_flow(db)
    return await get_flow(db, record.id)


async def update_flow(db: AsyncSession, flow_id: uuid.UUID, *, changes: dict[str, Any]) -> Flow:
    record = await _fetch_flow(db, flow_id)
    api = await _api_for_flow(db, changes.get("api_id", record.api_id))
    inputs = changes.get("inputs", [FlowInput.model_validate(i) for i in record.inputs])
    steps = changes.get("steps", [Step.model_validate(s) for s in record.steps])
    agents = await _validate(db, api, inputs, steps, changes.get("agent_ids"))
    name = changes.get("name", record.name)
    if name != record.name or api.id != record.api_id:
        await _ensure_flow_name_free(db, api.id, name, besides=record.id)
    record.api_id = api.id
    record.name = name
    record.description = changes.get("description", record.description)
    record.inputs = [item.model_dump(mode="json") for item in inputs]
    record.steps = [step.model_dump(mode="json") for step in steps]
    record.updated_at = func.now()
    if agents is not None:
        await _set_agents(db, record.id, agents)
    await _commit_flow(db)
    db.expire(record)
    return await get_flow(db, flow_id)


async def delete_flow(db: AsyncSession, flow_id: uuid.UUID) -> None:
    await db.delete(await _fetch_flow(db, flow_id))
    await db.commit()
