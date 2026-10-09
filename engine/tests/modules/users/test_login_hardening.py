"""Login hardening: throttling, email canonicalization, argon2 off the loop and transactions."""

import threading
import unicodedata
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from pwdlib.hashers.argon2 import Argon2Hasher
from sqlalchemy import select, update

from voice_eval.modules.users import passwords, service
from voice_eval.modules.users.models import LoginAttemptRecord, UserRecord
from voice_eval.modules.users.passwords import verify_and_update
from voice_eval.modules.users.throttle import ThrottlePolicy
from voice_eval.platform.app import create_app

EMAIL = "ada@example.com"
PASSWORD = "correct horse battery staple"
WRONG = "not the password"
CLIENT_IP = "127.0.0.1"  # what httpx's ASGITransport reports as the client address
THROTTLED = {"detail": "Too many login attempts, try again later"}


async def login(client, email=EMAIL, password=PASSWORD):
    return await client.post("/api/auth/login", json={"email": email, "password": password})


async def fail(client, times, email=EMAIL):
    for _ in range(times):
        assert (await login(client, email=email, password=WRONG)).status_code == 401


async def add_attempts(db, n, *, ago, email=EMAIL, ip=CLIENT_IP, succeeded=False):
    """Insert `n` attempts made `ago` before now (backdated, no argon2 involved)."""
    created_at = datetime.now(UTC) - ago
    async with db() as session:
        session.add_all(
            LoginAttemptRecord(email=email, ip=ip, succeeded=succeeded, created_at=created_at)
            for _ in range(n)
        )
        await session.commit()


async def attempts(db):
    async with db() as session:
        return (await session.execute(select(LoginAttemptRecord))).scalars().all()


@pytest.fixture
async def app_with(settings):
    """Build a client over an app whose settings are overridden; engines are disposed after."""
    apps = []

    async def build(**overrides):
        app = create_app(settings.model_copy(update=overrides))
        apps.append(app)
        return AsyncClient(transport=ASGITransport(app=app), base_url="https://testserver")

    yield build
    for app in apps:
        await app.state.engine.dispose()


# --- Throttling ----------------------------------------------------------------------------


async def test_sixth_attempt_is_throttled_even_with_the_right_password(client, make_user):
    await make_user()
    await fail(client, 5)
    response = await login(client)
    assert response.status_code == 429
    assert response.json() == THROTTLED
    assert "set-cookie" not in response.headers
    assert 0 < int(response.headers["retry-after"]) <= 15 * 60


async def test_unknown_email_is_throttled_identically(client, make_user):
    await make_user()
    await fail(client, 5)
    await fail(client, 5, email="nobody@example.com")
    known = await login(client)
    unknown = await login(client, email="nobody@example.com")
    assert known.status_code == unknown.status_code == 429
    assert known.json() == unknown.json() == THROTTLED
    assert set(known.headers) == set(unknown.headers)


async def test_per_ip_limit_spans_different_emails(app_with, make_user):
    await make_user()
    async with await app_with(login_max_failures_per_ip=3) as client:
        for n in range(3):
            await fail(client, 1, email=f"user{n}@example.com")
        response = await login(client)
    assert response.status_code == 429
    assert response.json() == THROTTLED


async def test_success_resets_the_per_email_counter(client, make_user):
    await make_user()
    await fail(client, 4)
    assert (await login(client)).status_code == 200
    await fail(client, 4)
    assert (await login(client)).status_code == 200
    await fail(client, 5)
    assert (await login(client)).status_code == 429


async def test_success_does_not_reset_the_per_ip_counter(app_with, make_user):
    await make_user()
    async with await app_with(login_max_failures_per_ip=3) as client:
        await fail(client, 1, email="eve@example.com")
        await fail(client, 1, email="mallory@example.com")
        assert (await login(client)).status_code == 200  # a valid account from the same IP
        await fail(client, 1, email="trent@example.com")
        response = await login(client)  # 3 IP failures in the window, success notwithstanding
    assert response.status_code == 429
    assert response.json() == THROTTLED


async def test_failures_outside_the_window_do_not_count(client, make_user, db):
    await make_user()
    await add_attempts(db, 5, ago=timedelta(minutes=16))
    assert (await login(client)).status_code == 200


async def test_retry_after_is_when_the_oldest_counted_failure_leaves_the_window(
    client, make_user, db
):
    await make_user()
    await add_attempts(db, 1, ago=timedelta(minutes=12))
    await add_attempts(db, 4, ago=timedelta(minutes=2))
    response = await login(client)
    assert response.status_code == 429
    assert 3 * 60 - 5 <= int(response.headers["retry-after"]) <= 3 * 60 + 1


async def test_throttled_request_never_verifies_a_password(client, make_user, db, monkeypatch):
    await make_user()
    await add_attempts(db, 5, ago=timedelta(minutes=1))
    calls = []

    def spy(*args):
        calls.append(args)
        return verify_and_update(*args)

    monkeypatch.setattr(service, "verify_and_update", spy)
    assert (await login(client)).status_code == 429
    assert (await login(client, email="nobody@example.com")).status_code == 401
    assert len(calls) == 1  # only the unthrottled unknown-email attempt reached argon2


async def test_every_verified_attempt_is_recorded(client, make_user, db):
    await make_user()
    await login(client, password=WRONG)
    await login(client)
    await login(client, email="not an email")
    recorded = sorted((a.email or "", a.succeeded, a.ip) for a in await attempts(db))
    assert recorded == [("", False, CLIENT_IP), (EMAIL, False, CLIENT_IP), (EMAIL, True, CLIENT_IP)]


async def test_attempts_older_than_a_day_are_purged(client, make_user, db):
    await make_user()
    await add_attempts(db, 3, ago=timedelta(hours=25), email="old@example.com")
    await add_attempts(db, 1, ago=timedelta(hours=23), email="recent@example.com")
    await login(client)
    emails = sorted(a.email for a in await attempts(db))
    assert emails == [EMAIL, "recent@example.com"]


# --- Email canonicalization ----------------------------------------------------------------


async def test_internationalized_email_logs_in_with_other_case_and_composition(client, make_user):
    user = await make_user(email="Usér@Exämple.com")
    assert user.email == "usér@exämple.com"
    decomposed = unicodedata.normalize("NFD", "USÉR@EXÄMPLE.COM")
    assert decomposed != unicodedata.normalize("NFC", decomposed)
    response = await login(client, email=decomposed)
    assert response.status_code == 200, response.text
    assert response.json()["user"]["id"] == str(user.id)


async def test_invalid_email_on_login_is_the_generic_401(client, make_user):
    await make_user()
    response = await login(client, email="not an email")
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}


# --- Argon2 off the event loop and outside DB transactions ---------------------------------


async def test_dummy_hash_is_never_computed_on_the_event_loop(client, monkeypatch):
    loop_thread = threading.current_thread()
    seen = []
    real_hash = passwords.hash_password

    def recording_hash(password: str) -> str:
        seen.append(threading.current_thread())
        return real_hash(password)

    service._dummy_hash.cache_clear()
    monkeypatch.setattr(service, "hash_password", recording_hash)
    try:
        assert (await login(client, email="nobody@example.com")).status_code == 401
    finally:
        service._dummy_hash.cache_clear()
    assert seen and all(thread is not loop_thread for thread in seen)


async def test_no_connection_is_held_while_argon2_runs(app, client, make_user, monkeypatch):
    await make_user()
    pool = app.state.engine.sync_engine.pool
    checked_out = []

    def probing_verify(*args):
        checked_out.append(pool.checkedout())
        return verify_and_update(*args)

    monkeypatch.setattr(service, "verify_and_update", probing_verify)
    assert (await login(client)).status_code == 200
    assert (await login(client, password=WRONG)).status_code == 401
    assert (await login(client, email="nobody@example.com")).status_code == 401
    assert checked_out == [0, 0, 0]


async def test_session_is_not_in_a_transaction_during_verification(
    db, make_user, settings, monkeypatch
):
    await make_user()
    async with db() as session:
        states = []

        def probing_verify(*args):
            states.append(session.in_transaction())
            return verify_and_update(*args)

        monkeypatch.setattr(service, "verify_and_update", probing_verify)
        issued = await service.login(
            session,
            EMAIL,
            PASSWORD,
            ttl=timedelta(hours=1),
            policy=ThrottlePolicy.from_settings(settings),
        )
    assert issued.user.email == EMAIL
    assert states == [False]


# --- Rehash on login -----------------------------------------------------------------------


async def test_outdated_hash_is_upgraded_on_login(client, make_user, db):
    user = await make_user()
    weak = Argon2Hasher(time_cost=1, memory_cost=8192, parallelism=1).hash(PASSWORD)
    assert verify_and_update(PASSWORD, weak)[1] is not None  # really outdated
    async with db() as session:
        await session.execute(
            update(UserRecord).where(UserRecord.id == user.id).values(password_hash=weak)
        )
        await session.commit()
    assert (await login(client)).status_code == 200
    async with db() as session:
        stored = await session.scalar(
            select(UserRecord.password_hash).where(UserRecord.id == user.id)
        )
    assert stored != weak
    assert verify_and_update(PASSWORD, stored) == (True, None)


async def test_failed_login_leaves_an_outdated_hash_alone(client, make_user, db):
    user = await make_user()
    weak = Argon2Hasher(time_cost=1, memory_cost=8192, parallelism=1).hash(PASSWORD)
    async with db() as session:
        await session.execute(
            update(UserRecord).where(UserRecord.id == user.id).values(password_hash=weak)
        )
        await session.commit()
    assert (await login(client, password=WRONG)).status_code == 401
    async with db() as session:
        stored = await session.scalar(
            select(UserRecord.password_hash).where(UserRecord.id == user.id)
        )
    assert stored == weak


def test_app_startup_warms_the_dummy_hash():
    from fastapi.testclient import TestClient

    from voice_eval.platform.settings import Settings

    service._dummy_hash.cache_clear()
    from cryptography.fernet import Fernet

    settings = Settings(
        _env_file=None,
        database_url="postgresql+asyncpg://u:p@db/x",
        voice_eval_master_key=Fernet.generate_key().decode(),
    )
    app = create_app(settings)
    try:
        with TestClient(app):
            assert service._dummy_hash.cache_info().currsize == 1
    finally:
        service._dummy_hash.cache_clear()
