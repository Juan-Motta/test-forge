"""HTTP API of scenario groups: `/api/scenario-groups/*` (behind authentication)."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import Field, StringConstraints, field_validator

from voice_eval.modules.scenarios import groups
from voice_eval.modules.scenarios.api import (
    AgentSummaryOut,
    CamelModel,
    CurrentPrincipal,
    Db,
    StrictCamelModel,
)
from voice_eval.modules.scenarios.domain import (
    MAX_NAME_LENGTH,
    GroupNameTaken,
    GroupNotEmpty,
    GroupNotFound,
    ScenarioGroup,
    Tags,
    unique_tags,
)

MAX_DESCRIPTION_LENGTH = 4000

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME_LENGTH)
]
Description = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=MAX_DESCRIPTION_LENGTH)
]


class GroupOut(CamelModel):
    id: uuid.UUID
    name: str
    description: str
    tags: list[str]
    scenario_count: int
    agents: list[AgentSummaryOut]
    latest_scenario_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, group: ScenarioGroup) -> "GroupOut":
        return cls(
            id=group.id,
            name=group.name,
            description=group.description,
            tags=group.tags,
            scenario_count=group.scenario_count,
            agents=[AgentSummaryOut(id=agent.id, name=agent.name) for agent in group.agents],
            latest_scenario_at=group.latest_scenario_at,
            created_at=group.created_at,
            updated_at=group.updated_at,
        )


class CreateGroupIn(StrictCamelModel):
    name: Name
    description: Description = ""
    tags: Tags = Field(default_factory=list)

    @field_validator("tags")
    @classmethod
    def _unique_tags(cls, value: list[str]) -> list[str]:
        return unique_tags(value)


class UpdateGroupIn(StrictCamelModel):
    """Partial update: only the fields present change; none of them may be `null`."""

    name: Name | None = None
    description: Description | None = None
    tags: Tags | None = None

    @field_validator("name", "description", "tags")
    @classmethod
    def required_when_present(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("may be omitted but not null")
        return value

    @field_validator("tags")
    @classmethod
    def _unique_tags(cls, value: list[str]) -> list[str]:
        return unique_tags(value)


def _name_taken() -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "Group name already in use")


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")


router = APIRouter(prefix="/scenario-groups", tags=["scenario groups"])


@router.get("", response_model=list[GroupOut])
async def list_groups(db: Db) -> list[GroupOut]:
    return [GroupOut.of(group) for group in await groups.list_groups(db)]


@router.post("", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
async def create_group(body: CreateGroupIn, principal: CurrentPrincipal, db: Db) -> GroupOut:
    try:
        created = await groups.create_group(
            db, fields=body.model_dump(), created_by=principal.user.id
        )
    except GroupNameTaken:
        raise _name_taken() from None
    return GroupOut.of(created)


@router.get("/{group_id}", response_model=GroupOut)
async def get_group(group_id: uuid.UUID, db: Db) -> GroupOut:
    try:
        return GroupOut.of(await groups.get_group(db, group_id))
    except GroupNotFound:
        raise _not_found() from None


@router.patch("/{group_id}", response_model=GroupOut)
async def update_group(group_id: uuid.UUID, body: UpdateGroupIn, db: Db) -> GroupOut:
    try:
        updated = await groups.update_group(
            db, group_id, changes={name: getattr(body, name) for name in body.model_fields_set}
        )
    except GroupNotFound:
        raise _not_found() from None
    except GroupNameTaken:
        raise _name_taken() from None
    return GroupOut.of(updated)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_id: uuid.UUID, db: Db) -> Response:
    try:
        await groups.delete_group(db, group_id)
    except GroupNotFound:
        raise _not_found() from None
    except GroupNotEmpty as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Group holds {exc.scenario_count} scenario(s); move or delete them first",
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
