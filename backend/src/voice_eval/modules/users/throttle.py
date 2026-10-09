"""Login throttling backed by the database, so every worker process sees the same counters.

A failed attempt counts against its email and its client IP for a sliding window. A successful
login resets the email counter (never the IP one: one valid account must not unlock guessing
at every other account from the same address). Only attempts that reached password
verification are recorded; throttled requests are not, so they cannot extend a lockout.
"""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.users.models import LoginAttemptRecord
from voice_eval.platform.settings import Settings

RETENTION = timedelta(hours=24)
PURGE_BATCH = 500


@dataclass(frozen=True)
class ThrottlePolicy:
    max_failures_per_email: int
    max_failures_per_ip: int
    window: timedelta

    @classmethod
    def from_settings(cls, settings: Settings) -> "ThrottlePolicy":
        return cls(
            max_failures_per_email=settings.login_max_failures_per_email,
            max_failures_per_ip=settings.login_max_failures_per_ip,
            window=timedelta(minutes=settings.login_window_minutes),
        )


async def _unlocks_at(
    db: AsyncSession, key: ColumnElement[bool], since: datetime, limit: int, window: timedelta
) -> datetime | None:
    """When the counter for `key` drops below `limit` again, or None if it is already below.

    That is when the `limit`-th most recent counted failure leaves the window.
    """
    nth_newest = await db.scalar(
        select(LoginAttemptRecord.created_at)
        .where(key, LoginAttemptRecord.succeeded.is_(False), LoginAttemptRecord.created_at > since)
        .order_by(LoginAttemptRecord.created_at.desc())
        .offset(limit - 1)
        .limit(1)
    )
    return nth_newest + window if nth_newest else None


async def retry_after(
    db: AsyncSession, email: str | None, ip: str | None, policy: ThrottlePolicy, now: datetime
) -> int | None:
    """Seconds the caller must wait before trying again, or None when not throttled."""
    window_start = now - policy.window
    unlocks: list[datetime] = []
    if email is not None:
        last_success = await db.scalar(
            select(func.max(LoginAttemptRecord.created_at)).where(
                LoginAttemptRecord.email == email,
                LoginAttemptRecord.succeeded.is_(True),
                LoginAttemptRecord.created_at > window_start,
            )
        )
        since = max(window_start, last_success) if last_success else window_start
        key = LoginAttemptRecord.email == email
        if at := await _unlocks_at(db, key, since, policy.max_failures_per_email, policy.window):
            unlocks.append(at)
    if ip is not None:
        key = LoginAttemptRecord.ip == ip
        limit = policy.max_failures_per_ip
        if at := await _unlocks_at(db, key, window_start, limit, policy.window):
            unlocks.append(at)
    if not unlocks:
        return None
    return max(1, math.ceil((max(unlocks) - now).total_seconds()))


async def record_attempt(
    db: AsyncSession, email: str | None, ip: str | None, *, succeeded: bool, now: datetime
) -> None:
    """Add the attempt to `db` (caller commits) and purge a bounded batch of expired rows."""
    db.add(LoginAttemptRecord(email=email, ip=ip, succeeded=succeeded, created_at=now))
    expired = (
        select(LoginAttemptRecord.id)
        .where(LoginAttemptRecord.created_at < now - RETENTION)
        .limit(PURGE_BATCH)
    )
    await db.execute(delete(LoginAttemptRecord).where(LoginAttemptRecord.id.in_(expired)))
