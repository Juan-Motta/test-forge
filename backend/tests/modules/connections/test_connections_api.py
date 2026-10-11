"""Connections API: CRUD with write-only secrets, connection tests (stored and draft)."""

import json
import uuid

import httpx
import pytest
from sqlalchemy import select

from voice_eval.modules.connections.api import connection_tester
from voice_eval.modules.connections.models import ConnectionRecord
from voice_eval.modules.connections.testers import ConnectionTester

API_KEY = "sk-proj-abcdefghijklmnop1234"
OPENAI = {
    "name": "OpenAI main",
    "kind": "openai",
    "config": {"ttsVoice": "coral"},
    "secrets": {"apiKey": API_KEY},
}
FIELDS = {
    "id",
    "name",
    "kind",
    "config",
    "secretHint",
    "hasSecret",
    "lastTest",
    "createdAt",
    "updatedAt",
}


async def create(client, **overrides):
    response = await client.post("/api/connections", json={**OPENAI, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


async def stored_row(db, connection_id) -> ConnectionRecord:
    async with db() as session:
        return await session.scalar(
            select(ConnectionRecord).where(ConnectionRecord.id == uuid.UUID(connection_id))
        )


@pytest.fixture
def provider(app):
    """Replace the connection tester's network with a recorder; set `.status` per test."""

    class Provider:
        status = 200
        requests: list[httpx.Request] = []

        def __call__(self, request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return httpx.Response(self.status, json={"echo": request.headers.get("authorization")})

    fake = Provider()
    fake.requests = []
    app.dependency_overrides[connection_tester] = lambda: ConnectionTester(
        transport=httpx.MockTransport(fake)
    )
    yield fake
    app.dependency_overrides.pop(connection_tester, None)


async def test_requires_authentication(client):
    assert (await client.get("/api/connections")).status_code == 401
    assert (await client.post("/api/connections", json=OPENAI)).status_code == 401
    assert (await client.post("/api/connections/test", json=OPENAI)).status_code == 401


async def test_create_returns_the_connection_without_secrets(user_client):
    body = await create(user_client)
    assert set(body) == FIELDS
    assert body["name"] == "OpenAI main"
    assert body["kind"] == "openai"
    assert body["config"] == {
        "baseUrl": "https://api.openai.com/v1",
        "ttsModel": "gpt-4o-mini-tts",
        "ttsVoice": "coral",
        "chatModel": "gpt-4.1-mini",
    }
    assert body["secretHint"] == "••••1234"
    assert body["hasSecret"] is True
    assert body["lastTest"] is None
    assert API_KEY not in json.dumps(body)


async def test_secret_is_stored_encrypted_and_bound_to_the_row(user_client, db, app):
    body = await create(user_client)
    row = await stored_row(db, body["id"])
    assert API_KEY not in row.secret_ciphertext
    assert API_KEY not in json.dumps(row.config)
    assert row.config == {
        "base_url": "https://api.openai.com/v1",
        "tts_model": "gpt-4o-mini-tts",
        "tts_voice": "coral",
        "chat_model": "gpt-4.1-mini",
    }
    assert row.created_by is not None
    box = app.state.secret_box
    assert box.open(row.secret_ciphertext, owner=row.id, kind="openai") == {"api_key": API_KEY}


async def test_list_and_get(user_client):
    b = await create(user_client, name="b-conn")
    a = await create(user_client, name="a-conn")
    listed = (await user_client.get("/api/connections")).json()
    assert [c["id"] for c in listed] == [a["id"], b["id"]]  # ordered by name
    got = await user_client.get(f"/api/connections/{a['id']}")
    assert got.status_code == 200
    assert got.json() == a


async def test_unknown_id_is_404(user_client):
    missing = uuid.uuid4()
    assert (await user_client.get(f"/api/connections/{missing}")).status_code == 404
    patch = await user_client.patch(f"/api/connections/{missing}", json={"name": "x"})
    assert patch.status_code == 404
    assert (await user_client.delete(f"/api/connections/{missing}")).status_code == 404
    assert (await user_client.post(f"/api/connections/{missing}/test")).status_code == 404


async def test_duplicate_name_is_409(user_client):
    await create(user_client, name="taken")
    other = await create(user_client, name="free")
    dup = await user_client.post("/api/connections", json={**OPENAI, "name": " taken "})
    assert dup.status_code == 409
    renamed = await user_client.patch(f"/api/connections/{other['id']}", json={"name": "taken"})
    assert renamed.status_code == 409


@pytest.mark.parametrize(
    ("overrides", "loc"),
    [
        ({"name": "   "}, ["body", "name"]),
        ({"name": "x" * 121}, ["body", "name"]),
        ({"kind": "elevenlabs"}, ["body", "kind"]),
        ({"config": {"baseUrl": "http://api.example.com"}}, ["body", "config", "baseUrl"]),
        ({"secrets": {}}, ["body", "secrets", "apiKey"]),
        ({"secrets": None}, ["body", "secrets"]),
    ],
)
async def test_create_validation_errors(user_client, overrides, loc):
    response = await user_client.post("/api/connections", json={**OPENAI, **overrides})
    assert response.status_code == 422
    assert loc in [error["loc"] for error in response.json()["detail"]]


async def test_patch_name_and_config_keep_the_stored_secret(user_client, db, app):
    body = await create(user_client)
    response = await user_client.patch(
        f"/api/connections/{body['id']}",
        json={"name": "renamed", "config": {"ttsModel": "tts-1", "ttsVoice": "nova"}},
    )
    assert response.status_code == 200, response.text
    patched = response.json()
    assert patched["name"] == "renamed"
    assert patched["config"]["ttsModel"] == "tts-1"
    assert patched["secretHint"] == "••••1234"
    assert patched["updatedAt"] >= body["updatedAt"]
    row = await stored_row(db, body["id"])
    box = app.state.secret_box
    assert box.open(row.secret_ciphertext, owner=row.id, kind="openai") == {"api_key": API_KEY}


async def test_patch_secrets_replaces_them(user_client, db, app):
    body = await create(user_client)
    new_key = "sk-proj-zyxwvutsrqponm9876"
    response = await user_client.patch(
        f"/api/connections/{body['id']}", json={"secrets": {"apiKey": new_key}}
    )
    assert response.status_code == 200
    assert response.json()["secretHint"] == "••••9876"
    row = await stored_row(db, body["id"])
    box = app.state.secret_box
    assert box.open(row.secret_ciphertext, owner=row.id, kind="openai") == {"api_key": new_key}


async def test_kind_is_immutable(user_client):
    body = await create(user_client)
    response = await user_client.patch(
        f"/api/connections/{body['id']}", json={"kind": "azure_openai"}
    )
    assert response.status_code == 422


async def test_delete(user_client):
    body = await create(user_client)
    assert (await user_client.delete(f"/api/connections/{body['id']}")).status_code == 204
    assert (await user_client.get(f"/api/connections/{body['id']}")).status_code == 404


async def test_foreign_origin_cannot_write_with_the_cookie(user_client):
    response = await user_client.post(
        "/api/connections", json=OPENAI, headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403


async def test_stored_test_records_the_outcome(user_client, provider):
    body = await create(user_client)
    response = await user_client.post(f"/api/connections/{body['id']}/test")
    assert response.status_code == 200
    result = response.json()
    assert (result["ok"], result["detail"]) == (True, "Connected (HTTP 200)")
    (request,) = provider.requests
    assert request.headers["authorization"] == f"Bearer {API_KEY}"  # decrypted for the call
    stored = (await user_client.get(f"/api/connections/{body['id']}")).json()
    assert stored["lastTest"] == {"at": result["at"], "ok": True, "detail": "Connected (HTTP 200)"}

    provider.status = 401
    failed = (await user_client.post(f"/api/connections/{body['id']}/test")).json()
    assert failed["ok"] is False
    stored = (await user_client.get(f"/api/connections/{body['id']}")).json()
    assert stored["lastTest"]["detail"] == "Authentication failed (HTTP 401)"


async def test_changing_credentials_clears_the_last_test(user_client, provider):
    body = await create(user_client)
    await user_client.post(f"/api/connections/{body['id']}/test")
    url = f"/api/connections/{body['id']}"
    renamed = (await user_client.patch(url, json={"name": "still tested"})).json()
    assert renamed["lastTest"] is not None
    changed = (await user_client.patch(url, json={"config": {"ttsVoice": "nova"}})).json()
    assert changed["lastTest"] is None


async def test_draft_test_persists_nothing(user_client, provider):
    response = await user_client.post(
        "/api/connections/test",
        json={"kind": "openai", "config": {}, "secrets": {"apiKey": API_KEY}},
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert str(provider.requests[0].url) == "https://api.openai.com/v1/models"
    assert (await user_client.get("/api/connections")).json() == []


async def test_draft_test_validates_input(user_client, provider):
    response = await user_client.post(
        "/api/connections/test",
        json={"kind": "openai", "config": {"baseUrl": "http://10.0.0.1"}, "secrets": {}},
    )
    assert response.status_code == 422
    assert provider.requests == []


async def test_undecryptable_secret_is_a_generic_500(user_client, db, provider):
    body = await create(user_client)
    async with db() as session:
        row = await session.get(ConnectionRecord, uuid.UUID(body["id"]))
        other = await create(user_client, name="other")
        row.secret_ciphertext = (await stored_row(db, other["id"])).secret_ciphertext  # swapped
        await session.commit()
    response = await user_client.post(f"/api/connections/{body['id']}/test")
    assert response.status_code == 500
    assert response.json() == {"detail": "Stored secret cannot be decrypted"}
    assert provider.requests == []
    assert (await user_client.get(f"/api/connections/{body['id']}")).status_code == 200
