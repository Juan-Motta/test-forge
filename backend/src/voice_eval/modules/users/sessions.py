"""Server-side sessions: opaque random tokens, stored only as SHA-256 hashes."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.users.domain import User
from voice_eval.modules.users.models import SessionRecord, UserRecord

TOUCH_INTERVAL = timedelta(minutes=1)


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
            user_agent=user_agent[:512] if user_agent else None,
            ip=ip[:45] if ip else None,
        )
    )
    return token, expires_at


async def resolve_session(db: AsyncSession, token: str) -> tuple[User, uuid.UUID] | None:
    """Return (user, session id) for a live session of an active user, else None."""
    now = datetime.now(UTC)
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
    if now - session.last_seen_at >= TOUCH_INTERVAL:
        await db.execute(
            update(SessionRecord).where(SessionRecord.id == session.id).values(last_seen_at=now)
        )
        await db.commit()
    return user.to_domain(), session.id


async def revoke_session(db: AsyncSession, session_id: uuid.UUID) -> None:
    await db.execute(delete(SessionRecord).where(SessionRecord.id == session_id))
    await db.commit()
