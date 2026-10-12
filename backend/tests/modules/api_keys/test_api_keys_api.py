"""Personal API keys: shown once, stored hashed, authenticate as their owner until revoked."""

import hashlib
import re
from datetime import UTC, datetime, timedelta

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text, update

from voice_eval.modules.api_keys.models import ApiKeyRecord
from voice_eval.modules.users.models import UserRecord

KEY_SHAPE = re.compile(r"ve_[a-z0-9]{8}_[A-Za-z0-9]{43}")
WEB_ORIGIN = "http://localhost:3000"
NOT_AUTHENTICATED = {"detail": "Not authenticated"}


async def create_key(client, name="ci", **extra) -> dict:
    response = await client.post("/api/api-keys", json={"name": name, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def bearer(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


async def fresh_client(app):
    """A client with no cookie: authenticates only with what each request carries."""
    return AsyncClient(transport=ASGITransport(app=app), base_url="https://testserver")


async def login_as(client, email: str) -> None:
    response = await client.post(
        "/api/auth/login", json={"email": email, "password": "correct horse battery staple"}
    )
    assert response.status_code == 200, response.text


async def test_create_returns_the_key_once_and_stores_only_its_hash(user_client, db):
    created = await create_key(user_client, name="  CI pipeline  ", expiresInDays=30)
    key = created["key"]
    assert KEY_SHAPE.fullmatch(key)
    assert created["name"] == "CI pipeline"
    assert created["prefix"] == key[:11]
    assert created["prefix"].startswith("ve_")
    assert created["lastUsedAt"] is None and created["revokedAt"] is None
    expires_at = datetime.fromisoformat(created["expiresAt"])
    assert timedelta(days=29, hours=23) < expires_at - datetime.now(UTC) <= timedelta(days=30)
    assert set(created) == {
        "id",
        "name",
        "prefix",
        "createdAt",
        "lastUsedAt",
        "expiresAt",
        "revokedAt",
        "key",
    }
    async with db() as session:
        rows = (await session.execute(text("SELECT * FROM api_keys"))).all()
    assert len(rows) == 1
    stored = rows[0]._mapping
    assert stored["key_hash"] == hashlib.sha256(key.encode()).hexdigest()
    secret = key.rsplit("_", 1)[1]
    assert all(secret not in str(value) for value in stored.values())


async def test_a_key_without_expiry_never_expires(user_client):
    assert (await create_key(user_client))["expiresAt"] is None
    explicit = await create_key(user_client, expiresInDays=None)
    assert explicit["expiresAt"] is None


async def test_create_validates_name_and_expiry(user_client):
    for body in (
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 81},
        {"name": "ci", "expiresInDays": 0},
        {"name": "ci", "expiresInDays": 3651},
        {},
    ):
        response = await user_client.post("/api/api-keys", json=body)
        assert response.status_code == 422, body


async def test_list_shows_own_keys_newest_first_and_never_the_key(user_client):
    first = await create_key(user_client, name="first")
    second = await create_key(user_client, name="second")
    revoked = await create_key(user_client, name="revoked")
    assert (await user_client.delete(f"/api/api-keys/{revoked['id']}")).status_code == 204

    response = await user_client.get("/api/api-keys")
    assert response.status_code == 200
    items = response.json()
    assert [item["name"] for item in items] == ["revoked", "second", "first"]
    assert items[0]["revokedAt"] is not None
    for item in items:
        assert "key" not in item
        assert set(item) == {
            "id",
            "name",
            "prefix",
            "createdAt",
            "lastUsedAt",
            "expiresAt",
            "revokedAt",
        }
    for created in (first, second, revoked):
        assert created["key"] not in response.text
        secret = created["key"].rsplit("_", 1)[1]
        assert secret not in response.text


async def test_a_key_authenticates_rest_calls_without_origin(app, user_client):
    key = (await create_key(user_client))["key"]
    async with await fresh_client(app) as client:
        me = await client.get("/api/auth/me", headers=bearer(key))
        assert me.status_code == 200
        assert me.json()["email"] == "ada@example.com"
        runs = await client.get("/api/runs", headers=bearer(key))
        assert runs.status_code == 200
        # unsafe methods with a key skip the Origin check, like any Bearer request
        other = await client.post(
            "/api/api-keys",
            json={"name": "made with a key"},
            headers={**bearer(key), "Origin": "https://evil.example"},
        )
        assert other.status_code == 201


async def test_bad_keys_get_the_same_401_as_a_bad_session_token(app, user_client, db):
    revoked = await create_key(user_client, name="revoked")
    await user_client.delete(f"/api/api-keys/{revoked['id']}")
    expired = await create_key(user_client, name="expired", expiresInDays=1)
    async with db() as session:
        await session.execute(
            update(ApiKeyRecord)
            .where(ApiKeyRecord.name == "expired")
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()
    valid = (await create_key(user_client, name="valid"))["key"]
    wrong_secret = valid[:-1] + ("A" if valid[-1] != "A" else "B")
    unknown_prefix = "ve_zzzzzzzz_" + valid.rsplit("_", 1)[1]

    async with await fresh_client(app) as client:
        reference = await client.get("/api/runs", headers=bearer("not-a-session-token"))
        assert reference.status_code == 401
        for key in (
            revoked["key"],
            expired["key"],
            wrong_secret,
            unknown_prefix,
            "ve_",
            "ve_short_x",
            valid + "x",
        ):
            response = await client.get("/api/runs", headers=bearer(key))
            assert response.status_code == 401, key
            assert response.json() == reference.json() == NOT_AUTHENTICATED
            assert response.headers["www-authenticate"] == "Bearer"
        assert (await client.get("/api/runs", headers=bearer(valid))).status_code == 200


async def test_last_used_is_recorded_at_most_once_a_minute(app, user_client, db):
    created = await create_key(user_client)
    key = created["key"]

    async def last_used():
        async with db() as session:
            return await session.scalar(
                select(ApiKeyRecord.last_used_at).where(ApiKeyRecord.id == created["id"])
            )

    async with await fresh_client(app) as client:
        await client.get("/api/auth/me", headers=bearer(key))
        first = await last_used()
        assert first is not None
        await client.get("/api/auth/me", headers=bearer(key))
        assert await last_used() == first  # within the minute: not written again

        stale = first - timedelta(minutes=2)
        async with db() as session:
            await session.execute(
                update(ApiKeyRecord)
                .where(ApiKeyRecord.id == created["id"])
                .values(last_used_at=stale)
            )
            await session.commit()
        await client.get("/api/auth/me", headers=bearer(key))
        assert await last_used() > stale

    listed = (await user_client.get("/api/api-keys")).json()
    assert listed[0]["lastUsedAt"] is not None


async def test_users_cannot_see_or_revoke_each_others_keys(app, user_client, make_user):
    ada_key = await create_key(user_client, name="ada")
    await make_user(email="grace@example.com", display_name="Grace Hopper")
    async with await fresh_client(app) as grace:
        await login_as(grace, "grace@example.com")
        assert (await grace.get("/api/api-keys")).json() == []
        response = await grace.delete(f"/api/api-keys/{ada_key['id']}")
        assert response.status_code == 404
        grace_key = await create_key(grace, name="grace")
        unknown = await grace.delete("/api/api-keys/00000000-0000-0000-0000-000000000000")
        assert unknown.status_code == 404
        assert (await grace.delete("/api/api-keys/not-a-uuid")).status_code == 422

    names = [item["name"] for item in (await user_client.get("/api/api-keys")).json()]
    assert names == ["ada"]
    assert (await user_client.delete(f"/api/api-keys/{grace_key['id']}")).status_code == 404
    async with await fresh_client(app) as client:
        assert (await client.get("/api/runs", headers=bearer(ada_key["key"]))).status_code == 200


async def test_revoking_is_idempotent_and_stops_the_key(app, user_client, db):
    created = await create_key(user_client)
    url = f"/api/api-keys/{created['id']}"
    assert (await user_client.delete(url, headers={"Origin": WEB_ORIGIN})).status_code == 204
    async with db() as session:
        revoked_at = await session.scalar(
            select(ApiKeyRecord.revoked_at).where(ApiKeyRecord.id == created["id"])
        )
    assert revoked_at is not None
    assert (await user_client.delete(url)).status_code == 204
    async with db() as session:
        again = await session.scalar(
            select(ApiKeyRecord.revoked_at).where(ApiKeyRecord.id == created["id"])
        )
    assert again == revoked_at  # the first revocation stands
    async with await fresh_client(app) as client:
        response = await client.get("/api/runs", headers=bearer(created["key"]))
        assert response.status_code == 401


async def test_cookie_requests_from_a_foreign_origin_cannot_manage_keys(user_client):
    created = await create_key(user_client)
    foreign = {"Origin": "https://evil.example"}
    response = await user_client.post("/api/api-keys", json={"name": "x"}, headers=foreign)
    assert response.status_code == 403
    response = await user_client.delete(f"/api/api-keys/{created['id']}", headers=foreign)
    assert response.status_code == 403


async def test_keys_of_a_deactivated_user_stop_working(app, user_client, db):
    key = (await create_key(user_client))["key"]
    async with db() as session:
        await session.execute(update(UserRecord).values(is_active=False))
        await session.commit()
    async with await fresh_client(app) as client:
        assert (await client.get("/api/runs", headers=bearer(key))).status_code == 401


async def test_logout_with_a_key_keeps_the_key(app, user_client):
    key = (await create_key(user_client))["key"]
    async with await fresh_client(app) as client:
        assert (await client.post("/api/auth/logout", headers=bearer(key))).status_code == 204
        assert (await client.get("/api/runs", headers=bearer(key))).status_code == 200


async def test_unauthenticated_requests_cannot_manage_keys(app, user_client):
    async with await fresh_client(app) as client:
        assert (await client.get("/api/api-keys")).status_code == 401
        assert (await client.post("/api/api-keys", json={"name": "x"})).status_code == 401
