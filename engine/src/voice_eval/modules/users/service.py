"""Users use cases: create a user, log in."""

import asyncio
import secrets
from datetime import UTC, datetime, timedelta
from functools import cache

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.users.domain import (
    MIN_PASSWORD_LENGTH,
    InvalidCredentials,
    InvalidUserInput,
    IssuedSession,
    User,
    UserAlreadyExists,
    normalize_email,
)
from voice_eval.modules.users.models import UserRecord
from voice_eval.modules.users.passwords import hash_password, verify_and_update
from voice_eval.modules.users.sessions import create_session


@cache
def _dummy_hash() -> str:
    """A real argon2id hash nobody knows the password of, to keep failed logins equally slow."""
    return hash_password(secrets.token_urlsafe(32))


async def create_user(db: AsyncSession, email: str, display_name: str, password: str) -> User:
    try:
        normalized = normalize_email(
            validate_email(email.strip(), check_deliverability=False).normalized
        )
    except EmailNotValidError as exc:
        raise InvalidUserInput(f"invalid email address: {exc}") from None
    display_name = display_name.strip()
    if not display_name or len(display_name) > 200:
        raise InvalidUserInput("display name must be 1 to 200 characters")
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
    user_agent: str | None = None,
    ip: str | None = None,
) -> IssuedSession:
    """Check credentials and open a session. Every failure is the same `InvalidCredentials`.

    A password hash is verified on every path (unknown email included) so response time does
    not reveal which emails exist.
    """
    record = await db.scalar(select(UserRecord).where(UserRecord.email == normalize_email(email)))
    stored_hash = record.password_hash if record else _dummy_hash()
    valid, new_hash = await asyncio.to_thread(verify_and_update, password, stored_hash)
    if record is None or not valid or not record.is_active:
        raise InvalidCredentials
    if new_hash:
        record.password_hash = new_hash
    record.last_login_at = datetime.now(UTC)
    token, expires_at = await create_session(db, record.id, ttl, user_agent=user_agent, ip=ip)
    await db.commit()
    return IssuedSession(user=record.to_domain(), token=token, expires_at=expires_at)
