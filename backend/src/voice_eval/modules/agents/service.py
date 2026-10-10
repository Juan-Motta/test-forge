"""Agents use cases: CRUD of the voice agents under test.

The API validates each field's shape; the rules that need settings or the database (the base
URL scheme allowed in this environment, the kind of the referenced Langfuse connection) live here
and report all their errors at once.
"""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.agents.domain import (
    Agent,
    AgentConflict,
    AgentInUse,
    AgentNameTaken,
    AgentNotFound,
    InvalidAgentInput,
    check_base_url,
)
from voice_eval.modules.agents.models import NAME_UNIQUE_CONSTRAINT, AgentRecord
from voice_eval.modules.connections.domain import ConnectionKind
from voice_eval.modules.connections.models import ConnectionRecord
from voice_eval.modules.scenarios.service import count_for_agent

FOREIGN_KEY_VIOLATION = "23503"
WRITABLE = frozenset(
    {
        "name",
        "context",
        "protocol",
        "base_url",
        "channel_id",
        "user_id",
        "origin",
        "langfuse_connection_id",
    }
)


def _name_taken(name: str) -> AgentNameTaken:
    return AgentNameTaken(f"an agent named {name!r} already exists")


async def _load(db: AsyncSession, agent_id: uuid.UUID) -> AgentRecord:
    record = await db.get(AgentRecord, agent_id)
    if record is None:
        raise AgentNotFound(str(agent_id))
    return record


def _violation(exc: IntegrityError) -> tuple[str | None, str | None]:
    """(SQLSTATE, constraint name) of the database error behind `exc`, when the driver says."""
    cause = exc.orig.__cause__ if exc.orig is not None else None  # asyncpg's own exception
    return getattr(cause, "sqlstate", None), getattr(cause, "constraint_name", None)


async def _commit(db: AsyncSession, name: str) -> None:
    """Commit; a lost race on the unique name is a name clash, a vanished reference a conflict."""
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        sqlstate, constraint = _violation(exc)
        if constraint == NAME_UNIQUE_CONSTRAINT:
            raise _name_taken(name) from None
        if sqlstate == FOREIGN_KEY_VIOLATION:
            raise AgentConflict("the agent refers to a row that no longer exists") from None
        raise


async def _validate(db: AsyncSession, fields: dict[str, Any], *, allow_local_ws: bool) -> None:
    """Normalize `fields` in place; raise `InvalidAgentInput` with every error found."""
    errors: list[dict[str, Any]] = []
    if "base_url" in fields:
        try:
            fields["base_url"] = check_base_url(fields["base_url"], allow_local_ws=allow_local_ws)
        except InvalidAgentInput as exc:
            errors += exc.errors
    connection_id = fields.get("langfuse_connection_id")
    if connection_id is not None:
        kind = await db.scalar(
            select(ConnectionRecord.kind).where(ConnectionRecord.id == connection_id)
        )
        if kind is None:
            msg = "connection not found"
        elif kind != ConnectionKind.LANGFUSE:
            msg = "must reference a langfuse connection"
        else:
            msg = ""
        if msg:
            errors.append({"type": "value_error", "loc": ["langfuseConnectionId"], "msg": msg})
    if errors:
        raise InvalidAgentInput(errors)


async def _ensure_name_free(db: AsyncSession, name: str) -> None:
    if await db.scalar(select(AgentRecord.id).where(AgentRecord.name == name)):
        raise _name_taken(name)


async def list_agents(db: AsyncSession) -> list[Agent]:
    records = await db.scalars(select(AgentRecord).order_by(AgentRecord.name))
    return [record.to_domain() for record in records]


async def get_agent(db: AsyncSession, agent_id: uuid.UUID) -> Agent:
    return (await _load(db, agent_id)).to_domain()


async def create_agent(
    db: AsyncSession,
    *,
    fields: dict[str, Any],
    created_by: uuid.UUID | None,
    allow_local_ws: bool,
) -> Agent:
    """`fields` holds every writable field (snake_case), already shape-validated."""
    fields = {key: value for key, value in fields.items() if key in WRITABLE}
    await _validate(db, fields, allow_local_ws=allow_local_ws)
    await _ensure_name_free(db, fields["name"])
    record = AgentRecord(id=uuid.uuid4(), created_by=created_by, **fields)
    db.add(record)
    await _commit(db, record.name)
    await db.refresh(record)
    return record.to_domain()


async def update_agent(
    db: AsyncSession,
    agent_id: uuid.UUID,
    *,
    changes: dict[str, Any],
    allow_local_ws: bool,
) -> Agent:
    """Apply the given fields only; omitted ones are kept."""
    record = await _load(db, agent_id)
    changes = {key: value for key, value in changes.items() if key in WRITABLE}
    await _validate(db, changes, allow_local_ws=allow_local_ws)
    name = changes.get("name")
    if name is not None and name != record.name:
        await _ensure_name_free(db, name)
    for key, value in changes.items():
        setattr(record, key, value)
    record.updated_at = func.now()
    await _commit(db, record.name)
    await db.refresh(record)
    return record.to_domain()


async def delete_agent(db: AsyncSession, agent_id: uuid.UUID) -> None:
    """Refused (`AgentInUse`) while scenarios reference the agent, even one added meanwhile."""
    record = await _load(db, agent_id)
    if scenarios := await count_for_agent(db, agent_id):
        raise AgentInUse(scenarios)
    await db.delete(record)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if _violation(exc)[0] != FOREIGN_KEY_VIOLATION:
            raise
        raise AgentInUse(await count_for_agent(db, agent_id)) from None
