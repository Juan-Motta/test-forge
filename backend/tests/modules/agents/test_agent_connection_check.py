"""Agent connection test: open the agent's WebSocket, wait until the session is ready, close it.

Only the in-process fake servers of `tests/conftest.py` are dialled; no audio is ever sent.
"""

import json
import socket
import uuid

import pytest

from voice_eval.modules.agents import connection_check

FIELDS = {"reachable", "latencyMs", "protocol", "log"}


async def agent_for(client, url: str, **overrides) -> str:
    body = {
        "name": f"Agent {uuid.uuid4().hex[:6]}",
        "baseUrl": url,
        "channelId": "channel-123",
        "userId": "probe-user",
        **overrides,
    }
    response = await client.post("/api/agents", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def messages(body: dict) -> list[str]:
    return [line["message"] for line in body["log"]]


async def test_requires_authentication(client):
    assert (await client.post(f"/api/agents/{uuid.uuid4()}/test")).status_code == 401


async def test_unknown_agent_is_404(user_client):
    assert (await user_client.post(f"/api/agents/{uuid.uuid4()}/test")).status_code == 404


async def test_live_agent_is_reachable(user_client, fake_live_server):
    agent_id = await agent_for(user_client, fake_live_server.url, origin="https://app.example.com")
    response = await user_client.post(f"/api/agents/{agent_id}/test")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == FIELDS
    assert (body["reachable"], body["protocol"]) == (True, "live")
    assert isinstance(body["latencyMs"], int) and body["latencyMs"] >= 0
    assert all(line["ok"] for line in body["log"])
    log = messages(body)
    assert log[0] == f"Dialing {fake_live_server.url}/channelApi/channel-123/realtime"
    assert any(line.startswith("Connected") for line in log)
    assert "Protocol detected: live" in log
    assert any(line.startswith("Session ready") for line in log)
    assert log[-1].startswith("Closed")
    # Closed like a run closes a Live session; no audio and nothing else was sent.
    assert fake_live_server.received_types == ["voice.close"]
    assert fake_live_server.origins == ["https://app.example.com"]
    assert "probe-user" not in " ".join(log)  # the query string is never logged


async def test_legacy_realtime_agent_is_reachable(user_client, fake_realtime_server):
    agent_id = await agent_for(user_client, fake_realtime_server.url)
    body = (await user_client.post(f"/api/agents/{agent_id}/test")).json()
    assert (body["reachable"], body["protocol"]) == (True, "realtime")
    assert "Protocol detected: realtime" in messages(body)
    await fake_realtime_server.closed.wait()
    assert fake_realtime_server.received_types == []  # no session.update, no response.create
    assert fake_realtime_server.client_close_codes == [1000]


async def test_a_forced_protocol_the_agent_does_not_speak_is_unreachable(
    user_client, fake_realtime_server
):
    agent_id = await agent_for(user_client, fake_realtime_server.url, protocol="live")
    body = (await user_client.post(f"/api/agents/{agent_id}/test")).json()
    assert (body["reachable"], body["latencyMs"], body["protocol"]) == (False, None, "realtime")
    assert body["log"][-1] == {
        "ok": False,
        "message": "The agent speaks the realtime protocol, but this agent is set to live",
    }


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


async def test_an_agent_that_refuses_the_connection_is_unreachable(user_client):
    agent_id = await agent_for(user_client, f"ws://127.0.0.1:{free_port()}")
    response = await user_client.post(f"/api/agents/{agent_id}/test")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["reachable"], body["latencyMs"], body["protocol"]) == (False, None, None)
    assert body["log"][0]["ok"] is True
    assert body["log"][-1]["ok"] is False
    assert "Could not connect" in body["log"][-1]["message"]


async def test_an_unknown_protocol_is_unreachable(user_client, scripted_server):
    server = await scripted_server([json.dumps({"type": "hello"})], close_code=1000)
    agent_id = await agent_for(user_client, server.url)
    body = (await user_client.post(f"/api/agents/{agent_id}/test")).json()
    assert body["reachable"] is False
    assert body["log"][-1] == {
        "ok": False,
        "message": "Connected, but the agent did not identify its protocol",
    }


async def test_a_session_never_ready_times_out(user_client, scripted_server, monkeypatch):
    monkeypatch.setattr(connection_check, "READY_TIMEOUT_S", 0.3)
    frames = [json.dumps({"type": "session.created", "session": {"id": "s"}})]
    server = await scripted_server(frames)  # then idles
    agent_id = await agent_for(user_client, server.url)
    body = (await user_client.post(f"/api/agents/{agent_id}/test")).json()
    assert (body["reachable"], body["protocol"]) == (False, "realtime")
    assert body["log"][-1] == {
        "ok": False,
        "message": "Connected, but the session was not ready within 0.3 s",
    }


@pytest.mark.parametrize("status", [403, 500])
async def test_a_rejected_handshake_is_unreachable(user_client, status):
    from websockets.asyncio.server import serve

    def reject(connection, request):
        return connection.respond(status, "no\n")

    async def handler(ws):  # never reached
        return None

    async with serve(handler, "127.0.0.1", 0, process_request=reject) as server:
        port = server.sockets[0].getsockname()[1]
        agent_id = await agent_for(user_client, f"ws://127.0.0.1:{port}")
        body = (await user_client.post(f"/api/agents/{agent_id}/test")).json()
    assert body["reachable"] is False
    assert body["log"][-1] == {
        "ok": False,
        "message": f"The agent rejected the connection (HTTP {status})",
    }
