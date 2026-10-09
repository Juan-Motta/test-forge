"""HTTP API of the connections module: `/api/connections/*` (behind authentication).

Secrets are write-only: requests may carry them, responses only ever carry a masked hint.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.connections import service
from voice_eval.modules.connections.domain import (
    MAX_NAME_LENGTH,
    Connection,
    ConnectionConflict,
    ConnectionKind,
    ConnectionNameTaken,
    ConnectionNotFound,
    InvalidConnectionInput,
    LastTest,
    config_for_api,
)
from voice_eval.modules.connections.testers import ConnectionTester
from voice_eval.modules.users.deps import Principal, current_principal
from voice_eval.platform.db import get_db_session
from voice_eval.platform.secrets import SecretBox, SecretDecryptionError, app_secret_box
from voice_eval.platform.settings import Settings, app_settings

Db = Annotated[AsyncSession, Depends(get_db_session)]
Box = Annotated[SecretBox, Depends(app_secret_box)]
AppSettings = Annotated[Settings, Depends(app_settings)]
Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME_LENGTH)
]


def connection_tester(settings: AppSettings) -> ConnectionTester:
    """FastAPI dependency (overridden in tests to keep provider calls off the network).

    Only development may test connections to private or local addresses.
    """
    return ConnectionTester(allow_private_destinations=settings.environment == "development")


Tester = Annotated[ConnectionTester, Depends(connection_tester)]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StrictCamelModel(CamelModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class LastTestOut(CamelModel):
    at: datetime
    ok: bool
    detail: str

    @classmethod
    def of(cls, test: LastTest) -> "LastTestOut":
        return cls(at=test.at, ok=test.ok, detail=test.detail)


class ConnectionOut(CamelModel):
    id: uuid.UUID
    name: str
    kind: ConnectionKind
    config: dict[str, Any]
    secret_hint: str
    has_secret: bool
    last_test: LastTestOut | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, connection: Connection) -> "ConnectionOut":
        return cls(
            id=connection.id,
            name=connection.name,
            kind=connection.kind,
            config=config_for_api(connection.config),
            secret_hint=connection.secret_hint,
            has_secret=connection.has_secret,
            last_test=LastTestOut.of(connection.last_test) if connection.last_test else None,
            created_at=connection.created_at,
            updated_at=connection.updated_at,
        )


class DraftIn(StrictCamelModel):
    kind: ConnectionKind
    config: dict[str, Any] = {}
    secrets: dict[str, Any]


class CreateIn(DraftIn):
    name: Name


class UpdateIn(StrictCamelModel):
    name: Name | None = None
    config: dict[str, Any] | None = None
    secrets: dict[str, Any] | None = None  # omitted: keep the stored secrets


def _invalid(exc: InvalidConnectionInput) -> HTTPException:
    """Same `{type, loc, msg}` items as request validation errors (see `platform.app`)."""
    detail = [
        {"type": error["type"], "loc": ["body", *error["loc"]], "msg": error["msg"]}
        for error in exc.errors
    ]
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def _name_taken() -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "Connection name already in use")


def _conflict() -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT, "Connection conflicts with a concurrent change; try again"
    )


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")


def _local_http(settings: Settings) -> bool:
    return settings.environment == "development"


router = APIRouter(prefix="/connections", tags=["connections"])


@router.get("", response_model=list[ConnectionOut])
async def list_connections(db: Db) -> list[ConnectionOut]:
    return [ConnectionOut.of(c) for c in await service.list_connections(db)]


@router.post("", response_model=ConnectionOut, status_code=status.HTTP_201_CREATED)
async def create_connection(
    body: CreateIn,
    principal: Annotated[Principal, Depends(current_principal)],
    db: Db,
    box: Box,
    settings: AppSettings,
) -> ConnectionOut:
    try:
        created = await service.create_connection(
            db,
            box,
            name=body.name,
            kind=body.kind,
            config=body.config,
            secrets=body.secrets,
            created_by=principal.user.id,
            allow_local_http=_local_http(settings),
        )
    except InvalidConnectionInput as exc:
        raise _invalid(exc) from None
    except ConnectionNameTaken:
        raise _name_taken() from None
    except ConnectionConflict:
        raise _conflict() from None
    return ConnectionOut.of(created)


@router.post("/test", response_model=LastTestOut)
async def run_draft_test(body: DraftIn, tester: Tester, settings: AppSettings) -> LastTestOut:
    try:
        result = await service.check_draft(
            tester,
            kind=body.kind,
            config=body.config,
            secrets=body.secrets,
            allow_local_http=_local_http(settings),
        )
    except InvalidConnectionInput as exc:
        raise _invalid(exc) from None
    return LastTestOut.of(result)


@router.get("/{connection_id}", response_model=ConnectionOut)
async def get_connection(connection_id: uuid.UUID, db: Db) -> ConnectionOut:
    try:
        return ConnectionOut.of(await service.get_connection(db, connection_id))
    except ConnectionNotFound:
        raise _not_found() from None


@router.patch("/{connection_id}", response_model=ConnectionOut)
async def update_connection(
    connection_id: uuid.UUID, body: UpdateIn, db: Db, box: Box, settings: AppSettings
) -> ConnectionOut:
    try:
        updated = await service.update_connection(
            db,
            box,
            connection_id,
            name=body.name,
            config=body.config,
            secrets=body.secrets,
            allow_local_http=_local_http(settings),
        )
    except ConnectionNotFound:
        raise _not_found() from None
    except InvalidConnectionInput as exc:
        raise _invalid(exc) from None
    except ConnectionNameTaken:
        raise _name_taken() from None
    except ConnectionConflict:
        raise _conflict() from None
    return ConnectionOut.of(updated)


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(connection_id: uuid.UUID, db: Db) -> Response:
    try:
        await service.delete_connection(db, connection_id)
    except ConnectionNotFound:
        raise _not_found() from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{connection_id}/test", response_model=LastTestOut)
async def run_stored_test(
    connection_id: uuid.UUID, db: Db, box: Box, tester: Tester, settings: AppSettings
) -> LastTestOut:
    try:
        result = await service.check_stored(
            db, box, tester, connection_id, allow_local_http=_local_http(settings)
        )
    except ConnectionNotFound:
        raise _not_found() from None
    except InvalidConnectionInput as exc:
        raise _invalid(exc) from None
    except SecretDecryptionError:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "Stored secret cannot be decrypted"
        ) from None
    return LastTestOut.of(result)
