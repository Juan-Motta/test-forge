"""Users use cases: create a user, log in."""

import asyncio
import secrets
from datetime import UTC, datetime, timedelta
from functools import cache

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.users import throttle
from voice_eval.modules.users.domain import (
    MAX_DISPLAY_NAME_LENGTH,
    MAX_IP_LENGTH,
    MIN_PASSWORD_LENGTH,
    InvalidCredentials,
    InvalidUserInput,
    IssuedSession,
    LoginThrottled,
    User,
    UserAlreadyExists,
    canonical_email,
)
from voice_eval.modules.users.models import UserRecord
from voice_eval.modules.users.passwords import hash_password, verify_and_update
from voice_eval.modules.users.sessions import create_session, purge_expired_sessions
from voice_eval.modules.users.throttle import ThrottlePolicy


@cache
def _dummy_hash() -> str:
    """A real argon2id hash nobody knows the password of, to keep failed logins equally slow.

    Blocking: only ever called from a worker thread (see `warm_up` and `_verify`).
    """
    return hash_password(secrets.token_urlsafe(32))


def _verify(password: str, stored_hash: str | None) -> tuple[bool, str | None]:
    """Worker-thread body: verify against the stored hash, or the dummy one for no user."""
    return verify_and_update(password, stored_hash if stored_hash is not None else _dummy_hash())


async def warm_up() -> None:
    """Compute the dummy hash off the event loop (app startup), so the first miss is not slower."""
    await asyncio.to_thread(_dummy_hash)


async def create_user(db: AsyncSession, email: str, display_name: str, password: str) -> User:
    normalized = canonical_email(email)
    display_name = display_name.strip()
    if not display_name or len(display_name) > MAX_DISPLAY_NAME_LENGTH:
        raise InvalidUserInput(f"display name must be 1 to {MAX_DISPLAY_NAME_LENGTH} characters")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise InvalidUserInput(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    if await db.scalar(select(UserRecord.id).where(UserRecord.email == normalized)):
        raise UserAlreadyExists(f"a user with email {normalized} already exists")
    record = UserRecord(
        email=normalized,
        display_name=display_name,
        password_hash=await asyncio.to_thread(hash_password, password),
    )
    db.add(record)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise UserAlreadyExists(f"a user with email {normalized} already exists") from None
    await db.refresh(record)
    return record.to_domain()


async def login(
    db: AsyncSession,
    email: str,
    password: str,
    *,
    ttl: timedelta,
    policy: ThrottlePolicy,
    user_agent: str | None = None,
    ip: str | None = None,
    now: datetime | None = None,
) -> IssuedSession:
    """Check credentials and open a session.

    Raises `LoginThrottled` (before any password work) when too many recent attempts failed,
    and `InvalidCredentials` for every other failure. A password hash is verified on every
    unthrottled path (unknown or invalid email included) so response time does not reveal which
    emails exist. The slow verification runs in a worker thread with no transaction open, so it
    never pins a pooled connection.
    """
    now = now or datetime.now(UTC)
    ip = ip[:MAX_IP_LENGTH] if ip else None
    try:
        canonical: str | None = canonical_email(email)
    except InvalidUserInput:
        canonical = None

    # Read phase: one short transaction, ended before the slow hash.
    wait = await throttle.retry_after(db, canonical, ip, policy, now)
    row = None
    if wait is None and canonical is not None:
        row = (
            await db.execute(
                select(UserRecord.id, UserRecord.password_hash, UserRecord.is_active).where(
                    UserRecord.email == canonical
                )
            )
        ).first()
    await db.rollback()
    if wait is not None:
        raise LoginThrottled(wait)

    valid, new_hash = await asyncio.to_thread(_verify, password, row.password_hash if row else None)

    # Write phase: a second short transaction.
    user = None
    if row is not None and valid and row.is_active:
        values: dict[str, object] = {"last_login_at": now}
        if new_hash:
            values["password_hash"] = new_hash
        user = await db.scalar(
            update(UserRecord)
            .where(UserRecord.id == row.id, UserRecord.is_active.is_(True))
            .values(**values)
            .returning(UserRecord)
        )
    await throttle.record_attempt(db, canonical, ip, succeeded=user is not None, now=now)
    await purge_expired_sessions(db, now)
    if user is None:
        await db.commit()
        raise InvalidCredentials
    token, expires_at = await create_session(db, user.id, ttl, user_agent=user_agent, ip=ip)
    await db.commit()
    return IssuedSession(user=user.to_domain(), token=token, expires_at=expires_at)
