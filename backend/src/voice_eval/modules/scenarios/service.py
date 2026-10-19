"""Scenarios use cases: CRUD and duplication of the scenarios authored for each agent.

The API validates each field's shape and the cross-item rules (unique fact keys, criteria
weights totalling 100); the rules that need the database (the agent exists, the TTS connection
has a speech-capable kind, the evaluator connection can chat) live here and report all their
errors at once.
"""

import uuid
from typing import Any

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.agents.models import AgentRecord
from voice_eval.modules.connections.domain import ConnectionKind, chat_model
from voice_eval.modules.connections.models import ConnectionRecord
from voice_eval.modules.scenarios.domain import (
    ConnectionRef,
    InvalidScenarioInput,
    Scenario,
    ScenarioConflict,
    ScenarioNameTaken,
    ScenarioNotFound,
    copy_name,
    resolve_evaluator,
    voice_error,
)
from voice_eval.modules.scenarios.models import (
    NAME_UNIQUE_CONSTRAINT,
    ScenarioGroupRecord,
    ScenarioRecord,
)

FOREIGN_KEY_VIOLATION = "23503"
TTS_KINDS = frozenset({ConnectionKind.OPENAI, ConnectionKind.AZURE_OPENAI})
WRITABLE = frozenset(
    {
        "agent_id",
        "group_id",
        "name",
        "tags",
        "context",
        "persona",
        "tts_connection_id",
        "evaluator_connection_id",
        "voice_override",
        "goal",
        "instructions",
        "facts",
        "criteria",
        "end_conditions",
        "interruptions",
        "evaluator_mode",
        "realtime_model",
    }
)
COPIED = WRITABLE - {"name"}


def _name_taken(name: str) -> ScenarioNameTaken:
    return ScenarioNameTaken(f"this agent already has a scenario named {name!r}")


def _json(value: Any) -> Any:
    """Structured parts as stored: pydantic models (or lists of them) become JSON data."""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_json(item) for item in value]
    return value


async def _fetch(db: AsyncSession, scenario_id: uuid.UUID) -> ScenarioRecord:
    """The row and its agent, re-read from the database (fresh timestamps and agent name)."""
    record = await db.scalar(
        select(ScenarioRecord)
        .where(ScenarioRecord.id == scenario_id)
        .execution_options(populate_existing=True)
    )
    if record is None:
        raise ScenarioNotFound(str(scenario_id))
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
            raise ScenarioConflict("the scenario refers to a row that no longer exists") from None
        raise


async def _connection_error(
    db: AsyncSession, connection_id: uuid.UUID, *, needs_chat: bool
) -> str | None:
    """Why `connection_id` cannot serve a scenario role (speech, or chat too), or None."""
    row = (
        await db.execute(
            select(ConnectionRecord.kind, ConnectionRecord.config).where(
                ConnectionRecord.id == connection_id
            )
        )
    ).one_or_none()
    if row is None:
        return "connection not found"
    if row.kind not in TTS_KINDS:
        return "must reference an openai or azure_openai connection"
    if needs_chat and chat_model(ConnectionKind(row.kind), row.config) is None:
        return "the connection has no chat deployment"
    return None


async def _validate(db: AsyncSession, fields: dict[str, Any]) -> None:
    errors: list[dict[str, Any]] = []
    agent_id = fields.get("agent_id")
    if agent_id is not None and not await db.scalar(
        select(AgentRecord.id).where(AgentRecord.id == agent_id)
    ):
        errors.append({"type": "value_error", "loc": ["agentId"], "msg": "agent not found"})
    group_id = fields.get("group_id")
    if group_id is not None and not await db.scalar(
        select(ScenarioGroupRecord.id).where(ScenarioGroupRecord.id == group_id)
    ):
        errors.append({"type": "value_error", "loc": ["groupId"], "msg": "group not found"})
    for field, loc, needs_chat in [
        ("tts_connection_id", "ttsConnectionId", False),
        ("evaluator_connection_id", "evaluatorConnectionId", True),
    ]:
        connection_id = fields.get(field)
        if connection_id is None:
            continue
        if msg := await _connection_error(db, connection_id, needs_chat=needs_chat):
            errors.append({"type": "value_error", "loc": [loc], "msg": msg})
    if errors:
        raise InvalidScenarioInput(errors)


def _check_voice(mode: str, voice_override: str | None) -> None:
    """The voice override must suit the evaluator mode the scenario ends up with."""
    if msg := voice_error(mode, voice_override):
        raise InvalidScenarioInput([{"type": "value_error", "loc": ["voiceOverride"], "msg": msg}])


async def _ensure_name_free(
    db: AsyncSession, agent_id: uuid.UUID, name: str, *, besides: uuid.UUID | None = None
) -> None:
    query = select(ScenarioRecord.id).where(
        ScenarioRecord.agent_id == agent_id, ScenarioRecord.name == name
    )
    if besides is not None:
        query = query.where(ScenarioRecord.id != besides)
    if await db.scalar(query):
        raise _name_taken(name)


async def _agent_group(db: AsyncSession, agent_id: uuid.UUID) -> uuid.UUID:
    """The group named after the agent, created when there is none: where a scenario created
    without a group goes, as the migration put every earlier scenario.

    `ON CONFLICT DO NOTHING`: requests creating the agent's first scenarios at once race to
    create the group; the losers wait for the winner and then use its group.
    """
    agent_name = await db.scalar(select(AgentRecord.name).where(AgentRecord.id == agent_id))
    await db.execute(
        insert(ScenarioGroupRecord)
        .values(id=uuid.uuid4(), name=agent_name)
        .on_conflict_do_nothing(index_elements=[ScenarioGroupRecord.name])
    )
    return await db.scalar(
        select(ScenarioGroupRecord.id).where(ScenarioGroupRecord.name == agent_name)
    )


async def list_scenarios(
    db: AsyncSession,
    *,
    agent_id: uuid.UUID | None = None,
    tag: str | None = None,
    group_id: uuid.UUID | None = None,
) -> list[Scenario]:
    """Most recently updated first; optionally only one agent's, one group's, or only those
    with `tag` (trimmed like stored tags; a blank one filters nothing)."""
    query = select(ScenarioRecord).order_by(
        ScenarioRecord.updated_at.desc(), ScenarioRecord.name, ScenarioRecord.id
    )
    if agent_id is not None:
        query = query.where(ScenarioRecord.agent_id == agent_id)
    if group_id is not None:
        query = query.where(ScenarioRecord.group_id == group_id)
    tag = tag.strip() if tag is not None else None
    if tag:
        query = query.where(ScenarioRecord.tags.contains([tag]))
    return [record.to_domain() for record in await db.scalars(query)]


async def get_scenario(db: AsyncSession, scenario_id: uuid.UUID) -> Scenario:
    return (await _fetch(db, scenario_id)).to_domain()


async def create_scenario(
    db: AsyncSession, *, fields: dict[str, Any], created_by: uuid.UUID | None
) -> Scenario:
    """`fields` holds every writable field (snake_case), already shape-validated."""
    fields = {key: _json(value) for key, value in fields.items() if key in WRITABLE}
    _check_voice(fields["evaluator_mode"], fields.get("voice_override"))
    await _validate(db, fields)
    await _ensure_name_free(db, fields["agent_id"], fields["name"])
    if fields.get("group_id") is None:
        fields["group_id"] = await _agent_group(db, fields["agent_id"])
    record = ScenarioRecord(id=uuid.uuid4(), created_by=created_by, **fields)
    db.add(record)
    await _commit(db, record.name)
    return (await _fetch(db, record.id)).to_domain()


async def update_scenario(
    db: AsyncSession, scenario_id: uuid.UUID, *, changes: dict[str, Any]
) -> Scenario:
    """Apply the given fields only; structured parts given are replaced as a whole."""
    record = await _fetch(db, scenario_id)
    changes = {key: _json(value) for key, value in changes.items() if key in WRITABLE}
    _check_voice(
        changes.get("evaluator_mode", record.evaluator_mode),
        changes.get("voice_override", record.voice_override),
    )
    await _validate(db, changes)
    agent_id = changes.get("agent_id", record.agent_id)
    name = changes.get("name", record.name)
    if (agent_id, name) != (record.agent_id, record.name):
        await _ensure_name_free(db, agent_id, name, besides=record.id)
    for key, value in changes.items():
        setattr(record, key, value)
    record.updated_at = func.now()
    await _commit(db, name)
    return (await _fetch(db, scenario_id)).to_domain()


async def delete_scenario(db: AsyncSession, scenario_id: uuid.UUID) -> None:
    record = await _fetch(db, scenario_id)
    await db.delete(record)
    await db.commit()


async def duplicate_scenario(
    db: AsyncSession, scenario_id: uuid.UUID, *, created_by: uuid.UUID | None
) -> Scenario:
    """A copy under the same agent named `<name> (copy)`, `(copy 2)`… (first free name)."""
    source = await _fetch(db, scenario_id)
    taken = set(
        await db.scalars(
            select(ScenarioRecord.name).where(ScenarioRecord.agent_id == source.agent_id)
        )
    )
    record = ScenarioRecord(
        id=uuid.uuid4(),
        name=copy_name(source.name, taken),
        created_by=created_by,
        **{key: getattr(source, key) for key in COPIED},
    )
    db.add(record)
    await _commit(db, record.name)
    return (await _fetch(db, record.id)).to_domain()


async def count_for_group(db: AsyncSession, group_id: uuid.UUID) -> int:
    return await db.scalar(
        select(func.count()).select_from(ScenarioRecord).where(ScenarioRecord.group_id == group_id)
    )


async def count_for_agent(db: AsyncSession, agent_id: uuid.UUID) -> int:
    return await db.scalar(
        select(func.count()).select_from(ScenarioRecord).where(ScenarioRecord.agent_id == agent_id)
    )


async def connection_ref(db: AsyncSession, connection_id: uuid.UUID | None) -> ConnectionRef | None:
    """The connection `connection_id` as a run role sees it; None when unset or deleted."""
    if connection_id is None:
        return None
    record = await db.get(ConnectionRecord, connection_id, populate_existing=True)
    if record is None:
        return None
    try:
        kind = ConnectionKind(record.kind)
    except ValueError:
        return ConnectionRef(id=record.id, name=record.name, chat_model=None)
    return ConnectionRef(id=record.id, name=record.name, chat_model=chat_model(kind, record.config))


async def evaluator_connection(db: AsyncSession, scenario: Scenario) -> ConnectionRef:
    """The connection whose chat model plays the caller in `scenario` (see `resolve_evaluator`).

    Raises `ScenarioNotRunnable` when no configured connection can chat.
    """
    return resolve_evaluator(
        evaluator=await connection_ref(db, scenario.evaluator_connection_id),
        tts=await connection_ref(db, scenario.tts_connection_id),
    )
