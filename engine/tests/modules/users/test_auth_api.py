import hashlib
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text, update

from voice_eval.modules.users.models import SessionRecord, UserRecord
from voice_eval.platform.app import create_app

EMAIL = "ada@example.com"
PASSWORD = "correct horse battery staple"
WEB_ORIGIN = "http://localhost:3000"
CLI = {"X-Client": "cli"}


async def login(client, email=EMAIL, password=PASSWORD, headers=None):
    return await client.post(
        "/api/auth/login", json={"email": email, "password": password}, headers=headers or {}
    )


async def cli_token(client) -> str:
    response = await login(client, headers=CLI)
    assert response.status_code == 200, response.text
    return response.json()["token"]


async def test_login_sets_hardened_cookie_and_hides_token(client, make_user):
    user = await make_user()
    response = await login(client, email="  Ada@Example.COM ")
    assert response.status_code == 200
    body = response.json()
    assert body["user"] == {"id": str(user.id), "email": EMAIL, "displayName": "Ada Lovelace"}
    expires_at = datetime.fromisoformat(body["expiresAt"])
    assert timedelta(hours=11, minutes=59) < expires_at - datetime.now(UTC) <= timedelta(hours=12)
    assert "token" not in body
    cookie = response.headers["set-cookie"]
    token = response.cookies["ve_session"]
    assert token and token not in response.text
    lowered = cookie.lower()
    for attribute in ("httponly", "samesite=lax", "secure", "path=/", "max-age=43200"):
        assert attribute in lowered


async def test_login_returns_token_only_for_cli_clients(client, make_user):
    await make_user()
    response = await login(client, headers=CLI)
    assert response.status_code == 200
    assert response.json()["token"] == response.cookies["ve_session"]


async def test_login_records_last_login(client, make_user, db):
    user = await make_user()
    await login(client)
    async with db() as session:
        last_login = await session.scalar(
            select(UserRecord.last_login_at).where(UserRecord.id == user.id)
        )
    assert last_login is not None


async def test_wrong_password_and_unknown_email_fail_identically(client, make_user):
    await make_user()
    wrong = await login(client, password="not the password")
    unknown = await login(client, email="nobody@example.com")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Invalid email or password"}
    assert "set-cookie" not in wrong.headers and "set-cookie" not in unknown.headers


async def test_inactive_user_cannot_log_in(client, make_user):
    await make_user(is_active=False)
    response = await login(client)
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}


async def test_login_from_foreign_origin_is_rejected(client, make_user):
    await make_user()
    response = await login(client, headers={"Origin": "https://evil.example"})
    assert response.status_code == 403


async def test_me_with_cookie(client, make_user):
    await make_user()
    await login(client)
    response = await client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["email"] == EMAIL


async def test_me_with_bearer(app, client, make_user):
    await make_user()
    token = await cli_token(client)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://testserver") as fresh:
        response = await fresh.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["displayName"] == "Ada Lovelace"


async def test_unauthenticated_me_is_401_with_bearer_challenge(client):
    response = await client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    bogus = await client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"})
    assert bogus.status_code == 401


async def test_expired_session_is_rejected(client, make_user, db):
    await make_user()
    token = await cli_token(client)
    async with db() as session:
        await session.execute(
            update(SessionRecord).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()
    response = await client.get("/api/auth/me")
    assert response.status_code == 401
    bearer = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert bearer.status_code == 401


async def test_deactivated_user_session_stops_working(client, make_user, db):
    user = await make_user()
    await login(client)
    async with db() as session:
        await session.execute(
            update(UserRecord).where(UserRecord.id == user.id).values(is_active=False)
        )
        await session.commit()
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_logout_revokes_session_and_clears_cookie(client, make_user):
    await make_user()
    token = await cli_token(client)
    response = await client.post("/api/auth/logout", headers={"Origin": WEB_ORIGIN})
    assert response.status_code == 204
    assert 've_session=""' in response.headers["set-cookie"] or "max-age=0" in (
        response.headers["set-cookie"].lower()
    )
    bearer = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert bearer.status_code == 401


async def test_session_token_is_stored_only_as_sha256(client, make_user, db):
    await make_user()
    token = await cli_token(client)
    async with db() as session:
        rows = (await session.execute(text("SELECT * FROM user_sessions"))).all()
    assert len(rows) == 1
    stored = rows[0]._mapping
    assert stored["token_hash"] == hashlib.sha256(token.encode()).hexdigest()
    assert all(token not in str(value) for value in stored.values())


async def test_api_is_deny_by_default(settings, make_user):
    probe = APIRouter()

    @probe.get("/probe")
    async def protected_probe() -> dict[str, str]:
        return {"secret": "data"}

    @probe.post("/probe")
    async def protected_write() -> dict[str, str]:
        return {"written": "yes"}

    app = create_app(settings, extra_routers=[probe])
    try:
        await make_user()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="https://testserver") as client:
            anonymous = await client.get("/api/probe")
            assert anonymous.status_code == 401
            assert anonymous.headers["www-authenticate"] == "Bearer"
            assert "secret" not in anonymous.text
            token = await cli_token(client)

            # cookie + foreign Origin on an unsafe method: rejected (CSRF baseline)
            foreign = await client.post("/api/probe", headers={"Origin": "https://evil.example"})
            assert foreign.status_code == 403
            # cookie + allowed Origin, and cookie without Origin (non-browser): accepted
            ours = await client.post("/api/probe", headers={"Origin": WEB_ORIGIN})
            assert ours.status_code == 200
            assert (await client.post("/api/probe")).status_code == 200
            # safe methods are never Origin-checked
            safe = await client.get("/api/probe", headers={"Origin": "https://evil.example"})
            assert safe.status_code == 200

            client.cookies.clear()
            bearer = await client.post(
                "/api/probe",
                headers={"Origin": "https://evil.example", "Authorization": f"Bearer {token}"},
            )
            assert bearer.status_code == 200
    finally:
        await app.state.engine.dispose()
