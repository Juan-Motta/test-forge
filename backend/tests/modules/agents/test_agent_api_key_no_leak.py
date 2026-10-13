"""A text agent's API key never leaves the backend: not in responses, logs or run snapshots."""

import json
import logging
import uuid

import httpx
import pytest

from voice_eval.modules.agents.api import text_transport
from voice_eval.modules.agents.models import AgentRecord
from voice_eval.modules.runs.domain import RunPlan, snapshot
from voice_eval.modules.scenarios import service as scenarios
from voice_eval.modules.scenarios.domain import ConnectionRef

SECRET = "LEAKCANARY-vivi-api-key-0005"
TEXT = {
    "name": "Vivi chat",
    "kind": "text",
    "baseUrl": "https://vivi.example.com",
    "channelId": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    "auth": "api_key",
    "apiKey": SECRET,
}


def scenario_body(agent_id: str) -> dict:
    return {
        "agentId": agent_id,
        "name": "Balance",
        "persona": {"name": "Lucía", "locale": "es-MX", "temperament": "hurried"},
        "goal": "Learn the current account balance.",
        "criteria": [
            {"text": "States the balance", "kind": "must", "source": "transcript", "weight": 100}
        ],
    }


def echo_everything(request: httpx.Request) -> httpx.Response:
    """A hostile agent: rejects the key and echoes every header back in body and headers."""
    echoed = " ".join(f"{k}={v}" for k, v in request.headers.items())
    return httpx.Response(401, text=f"invalid key: {echoed}", headers={"x-echo": echoed})


@pytest.fixture
def hostile_agent(app):
    app.dependency_overrides[text_transport] = lambda: httpx.MockTransport(echo_everything)
    yield
    app.dependency_overrides.pop(text_transport, None)


async def test_api_key_never_leaks(app, user_client, hostile_agent, caplog):
    caplog.set_level(logging.DEBUG)
    responses: list[httpx.Response] = []

    async def call(method: str, url: str, **kwargs) -> httpx.Response:
        response = await user_client.request(method, url, **kwargs)
        responses.append(response)
        return response

    created = await call("POST", "/api/agents", json=TEXT)
    assert created.status_code == 201, created.text
    agent_id = created.json()["id"]
    # the same key in failing requests: duplicate name, bad fields, wrong types, broken JSON
    assert (await call("POST", "/api/agents", json=TEXT)).status_code == 409
    bad = {**TEXT, "name": "bad", "channelId": "not-a-uuid", "baseUrl": "ftp://x"}
    assert (await call("POST", "/api/agents", json=bad)).status_code == 422
    voice = {"name": "voice", "baseUrl": "wss://a.example.com", "channelId": "c", "userId": "u"}
    assert (await call("POST", "/api/agents", json={**voice, "apiKey": SECRET})).status_code == 422
    wrong_type = {**TEXT, "name": "wrong", "apiKey": [SECRET]}
    assert (await call("POST", "/api/agents", json=wrong_type)).status_code == 422
    raw = f'{{"name": "broken", "kind": "text", "apiKey": "{SECRET}"'
    broken = await call(
        "POST", "/api/agents", content=raw, headers={"content-type": "application/json"}
    )
    assert broken.status_code == 422

    await call("GET", "/api/agents")
    await call("GET", f"/api/agents/{agent_id}")
    tested = await call("POST", f"/api/agents/{agent_id}/test")
    assert tested.json()["reachable"] is False
    patched = await call("PATCH", f"/api/agents/{agent_id}", json={"apiKey": SECRET, "x": 1})
    assert patched.status_code == 422
    assert (await call("PATCH", f"/api/agents/{agent_id}", json={"apiKey": SECRET})).is_success

    scenario = await call("POST", "/api/scenarios", json=scenario_body(agent_id))
    assert scenario.status_code == 201, scenario.text
    async with app.state.sessionmaker() as session:
        agent = (await session.get(AgentRecord, uuid.UUID(agent_id))).to_domain()
        loaded = await scenarios.get_scenario(session, uuid.UUID(scenario.json()["id"]))
    ref = ConnectionRef(id=uuid.uuid4(), name="OpenAI", chat_model="gpt")
    plan = RunPlan(scenario=loaded, agent=agent, tts=ref, evaluator=ref)
    snap = json.dumps(snapshot(plan))
    assert snap and SECRET not in snap
    assert json.loads(snap)["agent"]["kind"] == "text"
    assert SECRET not in repr(agent)

    logged = "\n".join(record.getMessage() + (record.exc_text or "") for record in caplog.records)
    assert SECRET not in logged
    for response in responses:
        assert SECRET not in response.text, (response.request.url, response.text)
        assert all(SECRET not in value for value in response.headers.values())
