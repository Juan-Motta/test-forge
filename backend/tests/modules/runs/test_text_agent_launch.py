"""Text agents: launch checks, the snapshot, and a whole run against an in-process chat agent.

The agent is an `httpx.MockTransport` on the run manager (`text_transport`) and the policy is a
scripted fake: nothing reaches the network or a provider.
"""

import json
import uuid

import httpx
import pytest
from runs_support import scenario_body, wait_for
from sqlalchemy import select

from voice_eval.modules.runs.models import RunBatchRecord, RunRecord
from voice_eval.ports.policy import CallerDecision, PolicyState

SECRET = "vk-run-key-0001"
TEXT_AGENT = {
    "name": "Vivi chat",
    "kind": "text",
    "baseUrl": "https://vivi.example.com",
    "channelId": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    "textMode": "stream",
    "auth": "api_key",
    "apiKey": SECRET,
}


def line(**fields) -> str:
    return "data: " + json.dumps({"message": "", "event": None, "type": None, **fields}) + "\n"


class ChatAgent:
    """Answers every message on the stream endpoint; records the requests."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        body = json.loads(request.content)
        stream = (
            line(event="on_tool_start", metadata={"toolName": "lookup"})
            + line(event="on_tool_end", metadata={"toolName": "lookup", "success": True})
            + line(message="You said: ", event="on_chat_model_stream")
            + line(message=body["message"], event="on_chat_model_stream")
            + line(event="on_chat_end")
        )
        return httpx.Response(200, text=stream, headers={"content-type": "text/event-stream"})


class TwoMessagePolicy:
    def __init__(self) -> None:
        self.states: list[PolicyState] = []

    async def next_turn(self, state: PolicyState) -> CallerDecision:
        self.states.append(state)
        if state.caller_turns < 2:
            return CallerDecision(f"message {state.caller_turns + 1}", False, "asking")
        return CallerDecision(None, True, "goal met")


async def text_scenario(factory, **overrides):
    agent = await factory.post("/api/agents", TEXT_AGENT)
    body = scenario_body(agent["id"], "Chat balance", **overrides)
    return agent, await factory.post("/api/scenarios", body)


async def test_a_text_scenario_needs_an_evaluator_model_connection(user_client, factory, drive):
    # a voice connection with a chat model is no fallback for text agents
    _, scenario = await text_scenario(factory, ttsConnectionId=await factory.openai())
    voice = await factory.scenario("Voice balance")

    response = await user_client.post(
        "/api/runs", json={"scenarioIds": [voice["id"], scenario["id"]]}
    )

    assert response.status_code == 422, response.text
    (error,) = response.json()["detail"]
    assert error["scenarioId"] == scenario["id"]
    assert error["loc"] == ["body", "scenarioIds", 1]
    assert "evaluator model connection" in error["msg"]
    assert drive.started == []
    async with user_client._transport.app.state.sessionmaker() as db:
        assert (await db.scalars(select(RunBatchRecord))).all() == []


async def test_a_text_scenario_launches_without_a_voice_connection(user_client, factory, drive):
    _, scenario = await text_scenario(
        factory,
        evaluatorConnectionId=await factory.openai(),
        endConditions={"maxDurationS": 60, "maxTurns": 7},
    )

    response = await user_client.post("/api/runs", json={"scenarioIds": [scenario["id"]]})

    assert response.status_code == 201, response.text
    (run,) = response.json()["runs"]
    uuid.UUID(run["threadId"])  # Vivi refuses a threadId that is not a UUID
    async with user_client._transport.app.state.sessionmaker() as db:
        record = await db.get(RunRecord, uuid.UUID(run["id"]))
    snap = record.snapshot
    assert snap["agent"]["kind"] == "text"
    assert snap["connections"]["tts"] is None
    assert snap["connections"]["evaluator"]["id"] == await factory.openai()
    assert snap["scenario"]["end_conditions"]["max_turns"] == 7
    assert SECRET not in json.dumps(snap)


@pytest.fixture
def chat_agent(app) -> ChatAgent:
    agent = ChatAgent()
    app.state.runs.text_transport = httpx.MockTransport(agent)
    return agent


async def test_a_text_run_chats_end_to_end(app, user_client, factory, chat_agent):
    policies: list[TwoMessagePolicy] = []

    async def build_policy(db, connection_id):
        policies.append(TwoMessagePolicy())
        return policies[-1]

    async def no_synthesizer(*args):
        raise AssertionError("text runs never synthesize speech")

    manager = app.state.runs
    manager.build_policy = build_policy
    manager.build_synthesizer = no_synthesizer
    manager.build_realtime_caller = no_synthesizer
    _, scenario = await text_scenario(
        factory,
        evaluatorConnectionId=await factory.openai(),
        voiceOverride="alloy",
        interruptions=[{"agentTurn": 1, "afterMs": 1500}],
    )

    response = await user_client.post("/api/runs", json={"scenarioIds": [scenario["id"]]})
    assert response.status_code == 201, response.text
    run_id = response.json()["runs"][0]["id"]

    async def finished() -> bool:
        return (await user_client.get(f"/api/runs/{run_id}")).json()["status"] == "completed"

    await wait_for(finished, within_s=30)

    detail = (await user_client.get(f"/api/runs/{run_id}")).json()
    assert detail["endReason"] == "caller_hung_up"
    assert [(row["role"], row["text"]) for row in detail["transcript"]] == [
        ("caller", "message 1"),
        ("agent", "You said: message 1"),
        ("caller", "message 2"),
        ("agent", "You said: message 2"),
    ]
    async with app.state.sessionmaker() as db:
        record = await db.get(RunRecord, uuid.UUID(run_id))
    summary = record.summary
    assert (summary["kind"], summary["text_mode"]) == ("text", "stream")
    assert summary["thread_id"] == record.thread_id
    assert (summary["caller_turns"], summary["agent_turns"]) == (2, 2)
    assert len(summary["latencies_ms"]) == 2
    assert summary["turns"][0]["tools"] == ["lookup"]
    assert any("interruptions" in warning for warning in summary["warnings"])
    assert any("voice" in warning for warning in summary["warnings"])

    # every message went to the same thread, with the sealed key opened at run time
    assert len(chat_agent.requests) == 2
    for request in chat_agent.requests:
        assert str(request.url).endswith(f"/channelsApi/{TEXT_AGENT['channelId']}/stream")
        assert json.loads(request.content)["threadId"] == record.thread_id
        assert request.headers["vivi-api-key"] == SECRET
    assert SECRET not in json.dumps(summary)
    assert SECRET not in (await user_client.get(f"/api/runs/{run_id}")).text

    for side in ("agent", "caller", "conversation"):
        audio = await user_client.get(f"/api/runs/{run_id}/audio/{side}")
        assert (audio.status_code, audio.json()["detail"]) == (404, "Audio not found")
    levels = await user_client.get(f"/api/runs/{run_id}/levels")
    assert levels.status_code == 404
    assert "text" in levels.json()["detail"]


async def test_an_agent_error_fails_the_text_run_with_its_message(app, user_client, factory):
    def cut_off(request: httpx.Request) -> httpx.Response:
        body = line(message="Partial", event="on_chat_model_stream")  # no on_chat_end
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    async def build_policy(db, connection_id):
        return TwoMessagePolicy()

    manager = app.state.runs
    manager.build_policy = build_policy
    manager.text_transport = httpx.MockTransport(cut_off)
    _, scenario = await text_scenario(factory, evaluatorConnectionId=await factory.openai())

    response = await user_client.post("/api/runs", json={"scenarioIds": [scenario["id"]]})
    run_id = response.json()["runs"][0]["id"]

    async def failed() -> bool:
        return (await user_client.get(f"/api/runs/{run_id}")).json()["status"] == "failed"

    await wait_for(failed, within_s=30)
    detail = (await user_client.get(f"/api/runs/{run_id}")).json()
    assert detail["endReason"] == "agent_error"
    assert "no on_chat_end" in detail["error"]
