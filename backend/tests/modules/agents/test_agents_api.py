"""Agents API: CRUD of the voice agents under test, and their Langfuse connection reference."""

import uuid

import pytest
from sqlalchemy import select

from voice_eval.modules.agents.models import AgentRecord

AGENT = {
    "name": "Vivi dev",
    "context": "Answers balance questions for retail customers.",
    "protocol": "live",
    "baseUrl": "wss://agents.example.com",
    "channelId": "channel-123",
    "userId": "probe-user",
}
FIELDS = {
    "id",
    "name",
    "context",
    "protocol",
    "baseUrl",
    "channelId",
    "userId",
    "origin",
    "langfuseConnectionId",
    "kind",
    "textMode",
    "auth",
    "hasApiKey",
    "apiKeyHint",
    "createdAt",
    "updatedAt",
}
LANGFUSE = {
    "kind": "langfuse",
    "config": {"host": "https://cloud.langfuse.com", "publicKey": "pk-lf-123"},
    "secrets": {"secretKey": "sk-lf-abcdefghijkl"},
}
OPENAI = {"kind": "openai", "config": {}, "secrets": {"apiKey": "sk-proj-abcdefghijklmnop"}}


async def create(client, **overrides):
    response = await client.post("/api/agents", json={**AGENT, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


async def connection(client, name: str, body: dict) -> str:
    response = await client.post("/api/connections", json={"name": name, **body})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def locs(response) -> list[list[str]]:
    return [error["loc"] for error in response.json()["detail"]]


async def test_requires_authentication(client):
    assert (await client.get("/api/agents")).status_code == 401
    assert (await client.post("/api/agents", json=AGENT)).status_code == 401
    assert (await client.get(f"/api/agents/{uuid.uuid4()}")).status_code == 401
    assert (await client.patch(f"/api/agents/{uuid.uuid4()}", json={})).status_code == 401
    assert (await client.delete(f"/api/agents/{uuid.uuid4()}")).status_code == 401


async def test_create_returns_the_agent(user_client, db):
    body = await create(user_client, origin="https://portal.example.com/")
    assert set(body) == FIELDS
    assert body["name"] == "Vivi dev"
    assert body["protocol"] == "live"
    assert body["baseUrl"] == "wss://agents.example.com"
    assert body["origin"] == "https://portal.example.com"
    assert body["langfuseConnectionId"] is None
    assert (body["kind"], body["textMode"], body["auth"]) == ("voice", None, None)
    assert (body["hasApiKey"], body["apiKeyHint"]) == (False, None)
    async with db() as session:
        row = await session.get(AgentRecord, uuid.UUID(body["id"]))
    assert row.created_by is not None


async def test_defaults(user_client):
    minimal = {k: v for k, v in AGENT.items() if k not in ("context", "protocol")}
    response = await user_client.post("/api/agents", json=minimal)
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["context"], body["protocol"], body["origin"]) == ("", "auto", None)


async def test_list_and_get(user_client):
    b = await create(user_client, name="b-agent")
    a = await create(user_client, name="a-agent")
    listed = (await user_client.get("/api/agents")).json()
    assert [agent["id"] for agent in listed] == [a["id"], b["id"]]  # ordered by name
    got = await user_client.get(f"/api/agents/{a['id']}")
    assert got.status_code == 200
    assert got.json() == a


async def test_unknown_id_is_404(user_client):
    missing = uuid.uuid4()
    assert (await user_client.get(f"/api/agents/{missing}")).status_code == 404
    assert (
        await user_client.patch(f"/api/agents/{missing}", json={"name": "x"})
    ).status_code == 404
    assert (await user_client.delete(f"/api/agents/{missing}")).status_code == 404


async def test_duplicate_name_is_409(user_client):
    await create(user_client, name="taken")
    other = await create(user_client, name="free")
    dup = await user_client.post("/api/agents", json={**AGENT, "name": " taken "})
    assert dup.status_code == 409
    assert dup.json() == {"detail": "Agent name already in use"}
    renamed = await user_client.patch(f"/api/agents/{other['id']}", json={"name": "taken"})
    assert renamed.status_code == 409


@pytest.mark.parametrize(
    ("overrides", "loc"),
    [
        ({"name": "   "}, ["body", "name"]),
        ({"name": "x" * 121}, ["body", "name"]),
        ({"context": "x" * 20001}, ["body", "context"]),
        ({"protocol": "grpc"}, ["body", "protocol"]),
        ({"baseUrl": "ws://agents.example.com"}, ["body", "baseUrl"]),
        ({"baseUrl": "ws://10.0.0.5:8000"}, ["body", "baseUrl"]),  # ws only to local hosts
        ({"baseUrl": "wss://user:pw@agents.example.com"}, ["body", "baseUrl"]),
        ({"baseUrl": "wss://agents.example.com?x=1"}, ["body", "baseUrl"]),
        ({"channelId": " "}, ["body", "channelId"]),
        ({"channelId": "a/b"}, ["body", "channelId"]),
        ({"channelId": "x" * 201}, ["body", "channelId"]),
        ({"userId": ""}, ["body", "userId"]),
        ({"userId": "bad\nid"}, ["body", "userId"]),
        ({"userId": "x" * 201}, ["body", "userId"]),
        ({"origin": "https://portal.example.com/path"}, ["body", "origin"]),
        ({"origin": "ftp://portal.example.com"}, ["body", "origin"]),
        ({"langfuseConnectionId": "not-a-uuid"}, ["body", "langfuseConnectionId"]),
        ({"threadId": "abc"}, ["body", "threadId"]),  # never stored on the agent
    ],
)
async def test_create_validation_errors(user_client, overrides, loc):
    response = await user_client.post("/api/agents", json={**AGENT, **overrides})
    assert response.status_code == 422, response.text
    assert loc in locs(response)


async def test_validation_errors_do_not_echo_the_input(user_client):
    response = await user_client.post(
        "/api/agents", json={**AGENT, "baseUrl": "wss://secret-user:secret-pw@host.example.com"}
    )
    assert response.status_code == 422
    assert "secret-pw" not in response.text


async def test_local_ws_is_accepted_outside_development(user_client, settings):
    assert settings.environment != "development"
    body = await create(user_client, baseUrl="ws://localhost:8000")
    assert body["baseUrl"] == "ws://localhost:8000"


async def test_langfuse_connection_reference(user_client):
    langfuse_id = await connection(user_client, "Langfuse", LANGFUSE)
    body = await create(user_client, langfuseConnectionId=langfuse_id)
    assert body["langfuseConnectionId"] == langfuse_id


async def test_langfuse_connection_must_be_langfuse_kind(user_client):
    openai_id = await connection(user_client, "OpenAI", OPENAI)
    wrong = await user_client.post("/api/agents", json={**AGENT, "langfuseConnectionId": openai_id})
    assert wrong.status_code == 422
    assert locs(wrong) == [["body", "langfuseConnectionId"]]
    missing = await user_client.post(
        "/api/agents", json={**AGENT, "langfuseConnectionId": str(uuid.uuid4())}
    )
    assert missing.status_code == 422
    assert locs(missing) == [["body", "langfuseConnectionId"]]


async def test_errors_from_several_rules_are_reported_together(user_client):
    openai_id = await connection(user_client, "OpenAI", OPENAI)
    response = await user_client.post(
        "/api/agents",
        json={**AGENT, "baseUrl": "http://x.example.com", "langfuseConnectionId": openai_id},
    )
    assert response.status_code == 422
    assert locs(response) == [["body", "baseUrl"], ["body", "langfuseConnectionId"]]


async def test_deleting_the_langfuse_connection_clears_the_reference(user_client):
    langfuse_id = await connection(user_client, "Langfuse", LANGFUSE)
    body = await create(user_client, langfuseConnectionId=langfuse_id)
    assert (await user_client.delete(f"/api/connections/{langfuse_id}")).status_code == 204
    got = (await user_client.get(f"/api/agents/{body['id']}")).json()
    assert got["langfuseConnectionId"] is None


async def test_patch_is_partial(user_client):
    langfuse_id = await connection(user_client, "Langfuse", LANGFUSE)
    body = await create(
        user_client, origin="https://portal.example.com", langfuseConnectionId=langfuse_id
    )
    url = f"/api/agents/{body['id']}"
    response = await user_client.patch(url, json={"name": "renamed", "protocol": "realtime"})
    assert response.status_code == 200, response.text
    patched = response.json()
    assert (patched["name"], patched["protocol"]) == ("renamed", "realtime")
    assert patched["baseUrl"] == body["baseUrl"]
    assert patched["origin"] == "https://portal.example.com"
    assert patched["langfuseConnectionId"] == langfuse_id
    assert patched["updatedAt"] >= body["updatedAt"]
    assert patched["createdAt"] == body["createdAt"]

    cleared = (
        await user_client.patch(url, json={"origin": None, "langfuseConnectionId": None})
    ).json()
    assert (cleared["origin"], cleared["langfuseConnectionId"]) == (None, None)
    assert cleared["name"] == "renamed"


@pytest.mark.parametrize(
    ("patch", "loc"),
    [
        ({"name": None}, ["body", "name"]),
        ({"baseUrl": None}, ["body", "baseUrl"]),
        ({"baseUrl": "ws://agents.example.com"}, ["body", "baseUrl"]),
        ({"channelId": "a b"}, ["body", "channelId"]),
        ({"protocol": None}, ["body", "protocol"]),
        ({"id": str(uuid.uuid4())}, ["body", "id"]),
    ],
)
async def test_patch_validation_errors(user_client, patch, loc):
    body = await create(user_client)
    response = await user_client.patch(f"/api/agents/{body['id']}", json=patch)
    assert response.status_code == 422, response.text
    assert loc in locs(response)


async def test_patch_checks_the_langfuse_kind(user_client):
    body = await create(user_client)
    openai_id = await connection(user_client, "OpenAI", OPENAI)
    response = await user_client.patch(
        f"/api/agents/{body['id']}", json={"langfuseConnectionId": openai_id}
    )
    assert response.status_code == 422
    assert locs(response) == [["body", "langfuseConnectionId"]]


async def test_delete(user_client, db):
    body = await create(user_client)
    assert (await user_client.delete(f"/api/agents/{body['id']}")).status_code == 204
    assert (await user_client.get(f"/api/agents/{body['id']}")).status_code == 404
    async with db() as session:
        assert await session.scalar(select(AgentRecord.id)) is None
