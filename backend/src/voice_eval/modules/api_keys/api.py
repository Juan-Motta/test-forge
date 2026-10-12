"""HTTP API of the API keys module: `/api/api-keys/*` (behind authentication).

A key is managed by any principal of its owner (a session or one of the owner's keys) and is
invisible to everyone else. The raw key is returned once, by `POST`, and never again.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.api_keys import service
from voice_eval.modules.api_keys.domain import (
    MAX_EXPIRES_IN_DAYS,
    MAX_NAME_LENGTH,
    ApiKey,
    ApiKeyNotFound,
)
from voice_eval.modules.users.deps import Principal, current_principal
from voice_eval.platform.db import get_db_session

Db = Annotated[AsyncSession, Depends(get_db_session)]
CurrentPrincipal = Annotated[Principal, Depends(current_principal)]

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME_LENGTH)
]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class CreateIn(CamelModel):
    name: Name
    expires_in_days: int | None = Field(default=None, ge=1, le=MAX_EXPIRES_IN_DAYS)


class ApiKeyOut(CamelModel):
    id: uuid.UUID
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None
    revoked_at: datetime | None

    @classmethod
    def of(cls, api_key: ApiKey) -> "ApiKeyOut":
        return cls(
            id=api_key.id,
            name=api_key.name,
            prefix=api_key.prefix,
            created_at=api_key.created_at,
            last_used_at=api_key.last_used_at,
            expires_at=api_key.expires_at,
            revoked_at=api_key.revoked_at,
        )


class CreatedApiKeyOut(ApiKeyOut):
    key: str  # the only time the raw key leaves the server


router = APIRouter(prefix="/api-keys", tags=["api-keys"])


@router.get("", response_model=list[ApiKeyOut])
async def list_api_keys(principal: CurrentPrincipal, db: Db) -> list[ApiKeyOut]:
    return [ApiKeyOut.of(api_key) for api_key in await service.list_api_keys(db, principal.user.id)]


@router.post("", response_model=CreatedApiKeyOut, status_code=status.HTTP_201_CREATED)
async def create_api_key(body: CreateIn, principal: CurrentPrincipal, db: Db) -> CreatedApiKeyOut:
    issued = await service.create_api_key(
        db, principal.user.id, body.name, expires_in_days=body.expires_in_days
    )
    return CreatedApiKeyOut(**ApiKeyOut.of(issued.api_key).model_dump(), key=issued.key)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(key_id: uuid.UUID, principal: CurrentPrincipal, db: Db) -> Response:
    try:
        await service.revoke_api_key(db, principal.user.id, key_id)
    except ApiKeyNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
