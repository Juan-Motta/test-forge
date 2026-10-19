"""Scenario groups use cases: the folders scenarios live in (a group may mix agents).

A group is deleted only once empty, so no scenario is ever left without one.
"""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.agents.models import AgentRecord
from voice_eval.modules.scenarios.domain import (
    AgentSummary,
    GroupNameTaken,
    GroupNotEmpty,
    GroupNotFound,
    ScenarioGroup,
)
from voice_eval.modules.scenarios.models import (
    GROUP_NAME_UNIQUE_CONSTRAINT,
    ScenarioGroupRecord,
    ScenarioRecord,
)
from voice_eval.modules.scenarios.service import _violation, count_for_group

WRITABLE = frozenset({"name", "description", "tags"})


def _name_taken(name: str) -> GroupNameTaken:
    return GroupNameTaken(f"a group named {name!r} already exists")


async def _commit(db: AsyncSession, name: str) -> None:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if _violation(exc)[1] == GROUP_NAME_UNIQUE_CONSTRAINT:
            raise _name_taken(name) from None
        raise


async def _ensure_name_free(
    db: AsyncSession, name: str, *, besides: uuid.UUID | None = None
) -> None:
    query = select(ScenarioGroupRecord.id).where(ScenarioGroupRecord.name == name)
    if besides is not None:
        query = query.where(ScenarioGroupRecord.id != besides)
    if await db.scalar(query):
        raise _name_taken(name)


async def _fetch(db: AsyncSession, group_id: uuid.UUID) -> ScenarioGroupRecord:
    record = await db.get(ScenarioGroupRecord, group_id, populate_existing=True)
    if record is None:
        raise GroupNotFound(str(group_id))
    return record


async def _summaries(db: AsyncSession, records: list[ScenarioGroupRecord]) -> list[ScenarioGroup]:
    """The groups with how many scenarios each holds, their agents and their latest change."""
    ids = [record.id for record in records]
    totals = {
        row.group_id: (row.count, row.latest)
        for row in await db.execute(
            select(
                ScenarioRecord.group_id,
                func.count().label("count"),
                func.max(ScenarioRecord.updated_at).label("latest"),
            )
            .where(ScenarioRecord.group_id.in_(ids))
            .group_by(ScenarioRecord.group_id)
        )
    }
    agents: dict[uuid.UUID, list[AgentSummary]] = {}
    for row in await db.execute(
        select(ScenarioRecord.group_id, AgentRecord.id, AgentRecord.name)
        .join(AgentRecord, AgentRecord.id == ScenarioRecord.agent_id)
        .where(ScenarioRecord.group_id.in_(ids))
        .distinct()
        .order_by(AgentRecord.name)
    ):
        group_id, agent_id, agent_name = row
        agents.setdefault(group_id, []).append(AgentSummary(id=agent_id, name=agent_name))
    return [
        ScenarioGroup(
            id=record.id,
            name=record.name,
            description=record.description,
            tags=list(record.tags),
            created_at=record.created_at,
            updated_at=record.updated_at,
            scenario_count=totals.get(record.id, (0, None))[0],
            agents=agents.get(record.id, []),
            latest_scenario_at=totals.get(record.id, (0, None))[1],
        )
        for record in records
    ]


async def list_groups(db: AsyncSession) -> list[ScenarioGroup]:
    """Alphabetical, like agents and connections."""
    records = list(await db.scalars(select(ScenarioGroupRecord).order_by(ScenarioGroupRecord.name)))
    return await _summaries(db, records)


async def get_group(db: AsyncSession, group_id: uuid.UUID) -> ScenarioGroup:
    return (await _summaries(db, [await _fetch(db, group_id)]))[0]


async def create_group(
    db: AsyncSession, *, fields: dict[str, Any], created_by: uuid.UUID | None
) -> ScenarioGroup:
    fields = {key: value for key, value in fields.items() if key in WRITABLE}
    await _ensure_name_free(db, fields["name"])
    record = ScenarioGroupRecord(id=uuid.uuid4(), created_by=created_by, **fields)
    db.add(record)
    await _commit(db, record.name)
    return await get_group(db, record.id)


async def update_group(
    db: AsyncSession, group_id: uuid.UUID, *, changes: dict[str, Any]
) -> ScenarioGroup:
    record = await _fetch(db, group_id)
    changes = {key: value for key, value in changes.items() if key in WRITABLE}
    name = changes.get("name", record.name)
    if name != record.name:
        await _ensure_name_free(db, name, besides=record.id)
    for key, value in changes.items():
        setattr(record, key, value)
    record.updated_at = func.now()
    await _commit(db, name)
    return await get_group(db, group_id)


async def delete_group(db: AsyncSession, group_id: uuid.UUID) -> None:
    record = await _fetch(db, group_id)
    if count := await count_for_group(db, group_id):
        raise GroupNotEmpty(count)
    await db.delete(record)
    try:
        await db.commit()
    except IntegrityError:
        # A scenario landed in the group meanwhile: the RESTRICT foreign key kept the group.
        await db.rollback()
        raise GroupNotEmpty(await count_for_group(db, group_id)) from None
