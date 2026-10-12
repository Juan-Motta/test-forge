"""API keys use cases: issue, list and revoke a user's keys, and resolve a presented key.

Resolving never writes; recording use (`touch_api_key`, at most once per `TOUCH_INTERVAL`) is a
separate step the caller commits, like sessions.
"""

import hmac
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.api_keys.domain import (
    ApiKey,
    ApiKeyNotFound,
    IssuedApiKey,
    display_prefix,
    generate_key,
    hash_key,
)
from voice_eval.modules.api_keys.models import ApiKeyRecord
from voice_eval.modules.users.domain import User
from voice_eval.modules.users.models import UserRecord

TOUCH_INTERVAL = timedelta(minutes=1)


@dataclass(frozen=True)
class ResolvedApiKey:
    user: User
    api_key_id: uuid.UUID
    touch_due: bool  # never used, or last used over TOUCH_INTERVAL ago: call `touch_api_key`


async def create_api_key(
    db: AsyncSession,
    user_id: uuid.UUID,
    name: str,
    *,
    expires_in_days: int | None = None,
    now: datetime | None = None,
) -> IssuedApiKey:
    """Store a new key of `user_id` (committed) and return it with its only raw copy."""
    now = now or datetime.now(UTC)
    key = generate_key()
    prefix = display_prefix(key)
    assert prefix is not None  # generate_key always yields a well-formed key
    record = ApiKeyRecord(
        user_id=user_id,
        name=name,
        prefix=prefix,
        key_hash=hash_key(key),
        created_at=now,
        expires_at=now + timedelta(days=expires_in_days) if expires_in_days else None,
    )
    db.add(record)
    await db.commit()
    return IssuedApiKey(api_key=record.to_domain(), key=key)


async def list_api_keys(db: AsyncSession, user_id: uuid.UUID) -> list[ApiKey]:
    """Every key of `user_id`, revoked and expired ones included, newest first."""
    records = await db.scalars(
        select(ApiKeyRecord)
        .where(ApiKeyRecord.user_id == user_id)
        .order_by(ApiKeyRecord.created_at.desc(), ApiKeyRecord.id.desc())
    )
    return [record.to_domain() for record in records]


async def revoke_api_key(
    db: AsyncSession, user_id: uuid.UUID, key_id: uuid.UUID, *, now: datetime | None = None
) -> None:
    """Revoke a key of `user_id` (committed); revoking it again keeps the first revocation.

    Raises `ApiKeyNotFound` for an unknown id or another user's key.
    """
    record = await db.get(ApiKeyRecord, key_id)
    if record is None or record.user_id != user_id:
        raise ApiKeyNotFound(str(key_id))
    await db.execute(
        update(ApiKeyRecord)
        .where(ApiKeyRecord.id == key_id, ApiKeyRecord.revoked_at.is_(None))
        .values(revoked_at=now or datetime.now(UTC))
    )
    await db.commit()


async def resolve_api_key(
    db: AsyncSession, key: str, *, now: datetime | None = None
) -> ResolvedApiKey | None:
    """The live key (not revoked, not expired, of an active user) that `key` is, else None.

    Read-only. Candidates are found by their public prefix; the hashes are then compared in
    constant time, so the lookup reveals nothing about how close a guess came.
    """
    prefix = display_prefix(key)
    if prefix is None:
        return None
    now = now or datetime.now(UTC)
    presented = hash_key(key)
    rows = await db.execute(
        select(ApiKeyRecord, UserRecord)
        .join(UserRecord, UserRecord.id == ApiKeyRecord.user_id)
        .where(
            ApiKeyRecord.prefix == prefix,
            ApiKeyRecord.revoked_at.is_(None),
            or_(ApiKeyRecord.expires_at.is_(None), ApiKeyRecord.expires_at > now),
            UserRecord.is_active.is_(True),
        )
    )
    for record, user in rows:
        if hmac.compare_digest(record.key_hash, presented):
            last_used = record.last_used_at
            return ResolvedApiKey(
                user=user.to_domain(),
                api_key_id=record.id,
                touch_due=last_used is None or now - last_used >= TOUCH_INTERVAL,
            )
    return None


async def touch_api_key(
    db: AsyncSession, api_key_id: uuid.UUID, *, now: datetime | None = None
) -> None:
    """Record a use of the key (caller commits)."""
    await db.execute(
        update(ApiKeyRecord)
        .where(ApiKeyRecord.id == api_key_id)
        .values(last_used_at=now or datetime.now(UTC))
    )
