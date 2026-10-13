"""Text agents: kind-specific validation, the sealed write-only API key, and the connection test.

The connection test talks to an `httpx.MockTransport` (dependency override); no real network.
"""

import json
import uuid

import httpx
import pytest

from voice_eval.modules.agents.api import text_transport
from voice_eval.modules.agents.models import AgentRecord

CHANNEL = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"
API_KEY = "vk-test-abcdefghij1234"
TEXT = {
    "name": "Vivi chat",
    "kind": "text",
    "context": "Answers balance questions in a chat.",
    "baseUrl": "https://vivi.example.com/api/",
    "channelId": CHANNEL,
}
VOICE = {
    "name": "Vivi voice",
    "baseUrl": "wss://agents.example.com",
    "channelId": "channel-123",
    "userId": "probe-user",
}


async def create(client, body: dict, **overrides) -> dict:
    response = await client.post("/api/agents", json={**body, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


def locs(response) -> list[list[str]]:
    return [error["loc"] for error in response.json()["detail"]]


async def test_create_a_text_agent_with_defaults(user_client):
    body = await create(user_client, TEXT)
    assert body["kind"] == "text"
    assert body["baseUrl"] == "https://vivi.example.com/api"
    assert body["channelId"] == CHANNEL
    assert (body["textMode"], body["auth"]) == ("stream", "none")
    assert (body["hasApiKey"], body["apiKeyHint"], body["userId"]) == (False, None, None)
    assert body["origin"] is None


async def test_local_http_is_accepted_for_text_agents(user_client):
    body = await create(user_client, TEXT, baseUrl="http://localhost:8000", textMode="invoke")
    assert (body["baseUrl"], body["textMode"]) == ("http://localhost:8000", "invoke")


@pytest.mark.parametrize(
    ("overrides", "loc"),
    [
        ({"baseUrl": "wss://vivi.example.com"}, ["body", "baseUrl"]),
        ({"baseUrl": "http://vivi.example.com"}, ["body", "baseUrl"]),  # http only to local hosts
        ({"baseUrl": "https://vivi.example.com?x=1"}, ["body", "baseUrl"]),
        ({"channelId": "channel-123"}, ["body", "channelId"]),  # a UUID for text agents
        ({"textMode": "poll"}, ["body", "textMode"]),
        ({"auth": "bearer"}, ["body", "auth"]),
        ({"auth": "api_key"}, ["body", "apiKey"]),  # the key is then required
        ({"userId": "probe-user"}, ["body", "userId"]),  # voice only
        ({"protocol": "live"}, ["body", "protocol"]),  # voice only
        ({"kind": "video"}, ["body", "kind"]),
    ],
)
async def test_text_validation_errors(user_client, overrides, loc):
    response = await user_client.post("/api/agents", json={**TEXT, **overrides})
    assert response.status_code == 422, response.text
    assert loc in locs(response)


@pytest.mark.parametrize(
    ("overrides", "loc"),
    [
        ({"userId": None}, ["body", "userId"]),  # still required for voice agents
        ({"textMode": "invoke"}, ["body", "textMode"]),
        ({"auth": "none"}, ["body", "auth"]),
        ({"apiKey": API_KEY}, ["body", "apiKey"]),
    ],
)
async def test_voice_agents_refuse_text_fields(user_client, overrides, loc):
    body = {key: value for key, value in {**VOICE, **overrides}.items() if value is not None}
    response = await user_client.post("/api/agents", json=body)
    assert response.status_code == 422, response.text
    assert loc in locs(response)
    assert API_KEY not in response.text


async def test_api_key_is_sealed_and_write_only(app, user_client, db):
    body = await create(user_client, TEXT, auth="api_key", apiKey=API_KEY)
    assert (body["auth"], body["hasApiKey"]) == ("api_key", True)
    assert body["apiKeyHint"] == "••••1234"
    assert "apiKey" not in body
    assert API_KEY not in (await user_client.get(f"/api/agents/{body['id']}")).text
    async with db() as session:
        row = await session.get(AgentRecord, uuid.UUID(body["id"]))
    assert API_KEY not in row.auth_ciphertext
    opened = app.state.secret_box.open(row.auth_ciphertext, owner=row.id, kind="agent_api_key")
    assert opened == {"apiKey": API_KEY}


async def test_api_key_can_be_replaced_and_is_cleared_with_auth_none(user_client):
    body = await create(user_client, TEXT, auth="api_key", apiKey=API_KEY)
    url = f"/api/agents/{body['id']}"

    renamed = (await user_client.patch(url, json={"name": "renamed"})).json()
    assert (renamed["hasApiKey"], renamed["apiKeyHint"]) == (True, "••••1234")

    rotated = (await user_client.patch(url, json={"apiKey": "vk-test-zzzzzzzzzz9876"})).json()
    assert rotated["apiKeyHint"] == "••••9876"

    refused = await user_client.patch(url, json={"apiKey": None})
    assert refused.status_code == 422
    assert locs(refused) == [["body", "apiKey"]]

    cleared = (await user_client.patch(url, json={"auth": "none", "apiKey": None})).json()
    assert (cleared["auth"], cleared["hasApiKey"], cleared["apiKeyHint"]) == (
        "none",
        False,
        None,
    )


async def test_switching_to_api_key_auth_requires_a_key(user_client):
    body = await create(user_client, TEXT)
    url = f"/api/agents/{body['id']}"
    refused = await user_client.patch(url, json={"auth": "api_key"})
    assert refused.status_code == 422
    assert locs(refused) == [["body", "apiKey"]]
    accepted = await user_client.patch(url, json={"auth": "api_key", "apiKey": API_KEY})
    assert accepted.status_code == 200
    assert accepted.json()["hasApiKey"] is True


@pytest.mark.parametrize(
    ("patch", "loc"),
    [
        ({"kind": "voice"}, ["body", "kind"]),  # the kind is fixed at creation
        ({"channelId": "channel-123"}, ["body", "channelId"]),
        ({"baseUrl": "wss://vivi.example.com"}, ["body", "baseUrl"]),
        ({"textMode": None}, ["body", "textMode"]),
        ({"userId": "probe-user"}, ["body", "userId"]),
    ],
)
async def test_text_patch_validation_errors(user_client, patch, loc):
    body = await create(user_client, TEXT)
    response = await user_client.patch(f"/api/agents/{body['id']}", json=patch)
    assert response.status_code == 422, response.text
    assert loc in locs(response)


async def test_voice_agent_kind_cannot_change(user_client):
    body = await create(user_client, VOICE)
    response = await user_client.patch(f"/api/agents/{body['id']}", json={"kind": "text"})
    assert response.status_code == 422
    assert locs(response) == [["body", "kind"]]
    same = await user_client.patch(f"/api/agents/{body['id']}", json={"kind": "voice"})
    assert same.status_code == 200


# --- connection test ----------------------------------------------------------------------


def data(**fields) -> str:
    return "data: " + json.dumps({"message": "", "event": None, "type": None, **fields}) + "\n"


class FakeChat:
    def __init__(self, status: int = 200, body: str | None = None) -> None:
        self.status = status
        self.body = body or (
            data(message="Hi, how can I help?", event="on_chat_model_stream")
            + data(event="on_chat_end")
        )
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, content=self.body.encode())


@pytest.fixture
def fake_chat(app):
    fake = FakeChat()
    app.dependency_overrides[text_transport] = lambda: httpx.MockTransport(fake)
    yield fake
    app.dependency_overrides.pop(text_transport, None)


async def test_connection_test_sends_one_message(user_client, fake_chat):
    body = await create(
        user_client, TEXT, auth="api_key", apiKey=API_KEY, origin="https://portal.example.com"
    )
    response = await user_client.post(f"/api/agents/{body['id']}/test")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["reachable"] is True
    assert isinstance(result["latencyMs"], int) and result["latencyMs"] >= 0
    assert result["protocol"] is None
    assert all(line["ok"] for line in result["log"])
    assert "Hi, how can I help?" not in response.text  # never what the agent said

    (request,) = fake_chat.requests
    assert str(request.url) == f"https://vivi.example.com/api/channelsApi/{CHANNEL}/stream"
    sent = json.loads(request.content)
    assert sent["message"] == "Hello, this is a connection test."
    assert uuid.UUID(sent["threadId"]).version == 4
    assert request.headers["vivi-api-key"] == API_KEY
    assert request.headers["origin"] == "https://portal.example.com"
    assert API_KEY not in response.text


async def test_connection_test_reports_a_failure(user_client, fake_chat):
    fake_chat.status = 403
    body = await create(user_client, TEXT)
    result = (await user_client.post(f"/api/agents/{body['id']}/test")).json()
    assert result["reachable"] is False
    assert result["latencyMs"] is None
    assert result["log"][-1]["ok"] is False
    assert "HTTP 403" in result["log"][-1]["message"]


async def test_connection_test_fails_on_a_stream_without_end(user_client, fake_chat):
    fake_chat.body = data(message="partial", event="on_chat_model_stream")
    body = await create(user_client, TEXT)
    result = (await user_client.post(f"/api/agents/{body['id']}/test")).json()
    assert result["reachable"] is False
    assert "on_chat_end" in result["log"][-1]["message"]
