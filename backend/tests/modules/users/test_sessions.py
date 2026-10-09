"""Sessions: explicit activity touch, expired-session purge and shared field limits."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from voice_eval.modules.users import sessions
from voice_eval.modules.users.api import LoginRequest
from voice_eval.modules.users.domain import (
    MAX_DISPLAY_NAME_LENGTH,
    MAX_EMAIL_LENGTH,
    MAX_IP_LENGTH,
    MAX_USER_AGENT_LENGTH,
    InvalidUserInput,
)
from voice_eval.modules.users.models import LoginAttemptRecord, SessionRecord, UserRecord

EMAIL = "ada@example.com"
PASSWORD = "correct horse battery staple"
CLI = {"X-Client": "cli"}


async def cli_token(client, headers=None) -> str:
    response = await client.post(
        "/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        headers={**CLI, **(headers or {})},
    )
    assert response.status_code == 200, response.text
    return response.json()["token"]


async def set_last_seen(db, ago: timedelta) -> datetime:
    seen = datetime.now(UTC) - ago
    async with db() as session:
        await session.execute(update(SessionRecord).values(last_seen_at=seen))
        await session.commit()
    return seen


async def last_seen(db) -> datetime:
    async with db() as session:
        return await session.scalar(select(SessionRecord.last_seen_at))


async def me(client, token):
    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    return response


async def test_last_seen_is_touched_only_after_the_touch_interval(client, make_user, db):
    await make_user()
    token = await cli_token(client)
    client.cookies.clear()

    recent = await set_last_seen(db, sessions.TOUCH_INTERVAL / 2)
    await me(client, token)
    assert await last_seen(db) == recent

    stale = await set_last_seen(db, sessions.TOUCH_INTERVAL * 2)
    await me(client, token)
    assert await last_seen(db) > stale + sessions.TOUCH_INTERVAL


async def test_resolve_session_is_read_only(client, make_user, db):
    await make_user()
    token = await cli_token(client)
    stale = await set_last_seen(db, sessions.TOUCH_INTERVAL * 2)
    async with db() as session:
        resolved = await sessions.resolve_session(session, token)
        assert resolved is not None
        assert resolved.touch_due is True
        assert resolved.user.email == EMAIL
        await session.rollback()  # whatever it did must not have been committed
    assert await last_seen(db) == stale

    async with db() as session:
        resolved = await sessions.resolve_session(session, token)
        await sessions.touch_session(session, resolved.session_id)
        await session.commit()
    assert await last_seen(db) > stale


async def _add_session(db, user_id, *, expires_in: timedelta) -> str:
    token_hash = hashlib.sha256(secrets.token_bytes(16)).hexdigest()
    now = datetime.now(UTC)
    async with db() as session:
        session.add(
            SessionRecord(
                user_id=user_id,
                token_hash=token_hash,
                created_at=now - timedelta(days=2),
                expires_at=now + expires_in,
                last_seen_at=now - timedelta(days=1),
            )
        )
        await session.commit()
    return token_hash


async def test_login_purges_expired_sessions(client, make_user, db):
    user = await make_user()
    expired = [await _add_session(db, user.id, expires_in=-timedelta(hours=1)) for _ in range(3)]
    live = await _add_session(db, user.id, expires_in=timedelta(hours=1))
    await cli_token(client)
    async with db() as session:
        hashes = set((await session.scalars(select(SessionRecord.token_hash))).all())
    assert live in hashes
    assert not hashes & set(expired)
    assert len(hashes) == 2  # the live one and the new one


async def test_failed_login_also_purges_expired_sessions(client, make_user, db):
    user = await make_user()
    expired = await _add_session(db, user.id, expires_in=-timedelta(minutes=1))
    response = await client.post(
        "/api/auth/login", json={"email": EMAIL, "password": "not the password"}
    )
    assert response.status_code == 401
    async with db() as session:
        hashes = set((await session.scalars(select(SessionRecord.token_hash))).all())
    assert expired not in hashes


def test_length_limits_are_shared_by_model_and_schema():
    columns = UserRecord.__table__.c
    assert columns.email.type.length == MAX_EMAIL_LENGTH
    assert columns.display_name.type.length == MAX_DISPLAY_NAME_LENGTH
    session_columns = SessionRecord.__table__.c
    assert session_columns.user_agent.type.length == MAX_USER_AGENT_LENGTH
    assert session_columns.ip.type.length == MAX_IP_LENGTH
    attempt_columns = LoginAttemptRecord.__table__.c
    assert attempt_columns.email.type.length == MAX_EMAIL_LENGTH
    assert attempt_columns.ip.type.length == MAX_IP_LENGTH
    email_field = LoginRequest.model_fields["email"]
    assert any(getattr(m, "max_length", None) == MAX_EMAIL_LENGTH for m in email_field.metadata)


async def test_long_user_agent_is_truncated_to_the_limit(client, make_user, db):
    await make_user()
    await cli_token(client, headers={"User-Agent": "ua-" + "x" * (MAX_USER_AGENT_LENGTH * 2)})
    async with db() as session:
        stored = await session.scalar(select(SessionRecord.user_agent))
    assert len(stored) == MAX_USER_AGENT_LENGTH


async def test_display_name_limit(make_user):
    await make_user(email="max@example.com", display_name="x" * MAX_DISPLAY_NAME_LENGTH)
    with pytest.raises(InvalidUserInput, match=str(MAX_DISPLAY_NAME_LENGTH)):
        await make_user(email="over@example.com", display_name="x" * (MAX_DISPLAY_NAME_LENGTH + 1))
