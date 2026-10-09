"""Connections use cases: CRUD with write-only secrets, and connection tests.

No database transaction is held open while a provider is called: a stored test reads the row,
ends the transaction, calls the provider, then records the outcome only if the row has not
changed in the meantime.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.connections.domain import (
    MAX_TEST_DETAIL_LENGTH,
    Connection,
    ConnectionConflict,
    ConnectionKind,
    ConnectionNameTaken,
    ConnectionNotFound,
    InvalidConnectionInput,
    LastTest,
    parse_config,
    parse_secrets,
    reveal,
    secret_hint,
)
from voice_eval.modules.connections.models import NAME_UNIQUE_CONSTRAINT, ConnectionRecord
from voice_eval.modules.connections.testers import ConnectionTester
from voice_eval.platform.secrets import SecretBox


def _name_taken(name: str) -> ConnectionNameTaken:
    return ConnectionNameTaken(f"a connection named {name!r} already exists")


async def _load(db: AsyncSession, connection_id: uuid.UUID) -> ConnectionRecord:
    record = await db.get(ConnectionRecord, connection_id)
    if record is None:
        raise ConnectionNotFound(str(connection_id))
    return record


FOREIGN_KEY_VIOLATION = "23503"


def _violation(exc: IntegrityError) -> tuple[str | None, str | None]:
    """(SQLSTATE, constraint name) of the database error behind `exc`, when the driver says."""
    cause = exc.orig.__cause__ if exc.orig is not None else None  # asyncpg's own exception
    return getattr(cause, "sqlstate", None), getattr(cause, "constraint_name", None)


async def _commit(db: AsyncSession, name: str) -> None:
    """Commit; a lost race on the unique name is a name clash, a missing referenced row a conflict.

    Any other integrity error is a bug (validation should have caught it) and propagates as is,
    which the API reports as a generic 500.
    """
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        sqlstate, constraint = _violation(exc)
        if constraint == NAME_UNIQUE_CONSTRAINT:
            raise _name_taken(name) from None
        if sqlstate == FOREIGN_KEY_VIOLATION:
            raise ConnectionConflict(
                "the connection refers to a row that no longer exists"
            ) from None
        raise


def _parse(
    kind: ConnectionKind, config: Any, secrets: Any, *, allow_local_http: bool
) -> tuple[Any, Any]:
    """Validate whichever of config and secrets is given (not None); report all errors at once."""
    errors: list[dict[str, Any]] = []
    parsed_config = parsed_secrets = None
    if config is not None:
        try:
            parsed_config = parse_config(kind, config, allow_local_http=allow_local_http)
        except InvalidConnectionInput as exc:
            errors += exc.errors
    if secrets is not None:
        try:
            parsed_secrets = parse_secrets(kind, secrets)
        except InvalidConnectionInput as exc:
            errors += exc.errors
    if errors:
        raise InvalidConnectionInput(errors)
    return parsed_config, parsed_secrets


def _seal(box: SecretBox, record: ConnectionRecord, secrets: BaseModel) -> None:
    record.secret_ciphertext = box.seal(reveal(secrets), owner=record.id, kind=record.kind)
    record.secret_hint = secret_hint(secrets)


def open_secrets(box: SecretBox, record: ConnectionRecord) -> BaseModel:
    """Decrypt and validate the stored secrets of `record`."""
    kind = ConnectionKind(record.kind)
    return parse_secrets(kind, box.open(record.secret_ciphertext, owner=record.id, kind=kind))


async def list_connections(db: AsyncSession) -> list[Connection]:
    records = await db.scalars(select(ConnectionRecord).order_by(ConnectionRecord.name))
    return [record.to_domain() for record in records]


async def get_connection(db: AsyncSession, connection_id: uuid.UUID) -> Connection:
    return (await _load(db, connection_id)).to_domain()


async def create_connection(
    db: AsyncSession,
    box: SecretBox,
    *,
    name: str,
    kind: ConnectionKind,
    config: Any,
    secrets: Any,
    created_by: uuid.UUID | None,
    allow_local_http: bool,
) -> Connection:
    parsed_config, parsed_secrets = _parse(kind, config, secrets, allow_local_http=allow_local_http)
    if await db.scalar(select(ConnectionRecord.id).where(ConnectionRecord.name == name)):
        raise _name_taken(name)
    record = ConnectionRecord(
        id=uuid.uuid4(),
        name=name,
        kind=kind.value,
        config=parsed_config.model_dump(mode="json"),
        created_by=created_by,
    )
    _seal(box, record, parsed_secrets)
    db.add(record)
    await _commit(db, name)
    await db.refresh(record)
    return record.to_domain()


async def update_connection(
    db: AsyncSession,
    box: SecretBox,
    connection_id: uuid.UUID,
    *,
    name: str | None = None,
    config: Any = None,
    secrets: Any = None,
    allow_local_http: bool,
) -> Connection:
    """Rename and/or replace the config or secrets. Omitted parts are kept; kind never changes.

    A new config or new secrets invalidate the last test result.
    """
    record = await _load(db, connection_id)
    parsed_config, parsed_secrets = _parse(
        ConnectionKind(record.kind), config, secrets, allow_local_http=allow_local_http
    )
    if name is not None and name != record.name:
        if await db.scalar(select(ConnectionRecord.id).where(ConnectionRecord.name == name)):
            raise _name_taken(name)
        record.name = name
    if parsed_config is not None:
        record.config = parsed_config.model_dump(mode="json")
    if parsed_secrets is not None:
        _seal(box, record, parsed_secrets)
    if parsed_config is not None or parsed_secrets is not None:
        record.last_tested_at = record.last_test_ok = record.last_test_detail = None
    record.updated_at = func.now()
    await _commit(db, record.name)
    await db.refresh(record)
    return record.to_domain()


async def delete_connection(db: AsyncSession, connection_id: uuid.UUID) -> None:
    record = await _load(db, connection_id)
    await db.delete(record)
    await db.commit()


async def check_draft(
    tester: ConnectionTester,
    *,
    kind: ConnectionKind,
    config: Any,
    secrets: Any,
    allow_local_http: bool,
) -> LastTest:
    """Test credentials that are not stored; nothing is persisted."""
    parsed_config, parsed_secrets = _parse(kind, config, secrets, allow_local_http=allow_local_http)
    result = await tester.check(kind, parsed_config, parsed_secrets)
    return LastTest(at=datetime.now(UTC), ok=result.ok, detail=result.detail)


async def check_stored(
    db: AsyncSession,
    box: SecretBox,
    tester: ConnectionTester,
    connection_id: uuid.UUID,
    *,
    allow_local_http: bool,
) -> LastTest:
    """Test a stored connection and record the outcome on it."""
    record = await _load(db, connection_id)
    kind = ConnectionKind(record.kind)
    seen_update = record.updated_at
    parsed_config = parse_config(kind, record.config, allow_local_http=allow_local_http)
    parsed_secrets = open_secrets(box, record)
    await db.rollback()  # no transaction (or pooled connection) held during the HTTP call

    result = await tester.check(kind, parsed_config, parsed_secrets)
    tested = LastTest(
        at=datetime.now(UTC), ok=result.ok, detail=result.detail[:MAX_TEST_DETAIL_LENGTH]
    )
    await db.execute(
        update(ConnectionRecord)
        .where(ConnectionRecord.id == connection_id, ConnectionRecord.updated_at == seen_update)
        .values(last_tested_at=tested.at, last_test_ok=tested.ok, last_test_detail=tested.detail)
    )
    await db.commit()
    return tested
