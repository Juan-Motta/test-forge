"""Server-side sessions: opaque random tokens, stored only as SHA-256 hashes.

Looking a session up never writes. Recording activity is a separate, explicit step
(`touch_session`, at most once per `TOUCH_INTERVAL`) that the caller commits, and expired
sessions are purged in bounded batches by `purge_expired_sessions` (called on login).
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.users.domain import MAX_IP_LENGTH, MAX_USER_AGENT_LENGTH, User
from voice_eval.modules.users.models import SessionRecord, UserRecord

TOUCH_INTERVAL = timedelta(minutes=1)
PURGE_BATCH = 500


@dataclass(frozen=True)
class ResolvedSession:
    user: User
    session_id: uuid.UUID
    touch_due: bool  # last activity is older than TOUCH_INTERVAL: call `touch_session`


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    ttl: timedelta,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
) -> tuple[str, datetime]:
    """Add a session to `db` (caller commits) and return (raw token, expires_at)."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    expires_at = now + ttl
    db.add(
        SessionRecord(
            user_id=user_id,
            token_hash=hash_token(token),
            created_at=now,
            expires_at=expires_at,
            last_seen_at=now,
            user_agent=user_agent[:MAX_USER_AGENT_LENGTH] if user_agent else None,
            ip=ip[:MAX_IP_LENGTH] if ip else None,
        )
    )
    return token, expires_at


async def resolve_session(
    db: AsyncSession, token: str, *, now: datetime | None = None
) -> ResolvedSession | None:
    """The live session of an active user that `token` opens, else None. Read-only."""
    now = now or datetime.now(UTC)
    row = (
        await db.execute(
            select(SessionRecord, UserRecord)
            .join(UserRecord, UserRecord.id == SessionRecord.user_id)
            .where(
                SessionRecord.token_hash == hash_token(token),
                SessionRecord.expires_at > now,
                UserRecord.is_active.is_(True),
            )
        )
    ).first()
    if row is None:
        return None
    session, user = row
    return ResolvedSession(
        user=user.to_domain(),
        session_id=session.id,
        touch_due=now - session.last_seen_at >= TOUCH_INTERVAL,
    )


async def touch_session(
    db: AsyncSession, session_id: uuid.UUID, *, now: datetime | None = None
) -> None:
    """Record activity on the session (caller commits)."""
    await db.execute(
        update(SessionRecord)
        .where(SessionRecord.id == session_id)
        .values(last_seen_at=now or datetime.now(UTC))
    )


async def purge_expired_sessions(db: AsyncSession, now: datetime) -> None:
    """Delete a bounded batch of expired sessions (caller commits)."""
    expired = select(SessionRecord.id).where(SessionRecord.expires_at <= now).limit(PURGE_BATCH)
    await db.execute(delete(SessionRecord).where(SessionRecord.id.in_(expired)))


async def revoke_session(db: AsyncSession, session_id: uuid.UUID) -> None:
    await db.execute(delete(SessionRecord).where(SessionRecord.id == session_id))
    await db.commit()
