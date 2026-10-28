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


class _EarlyEndSession:
    """A session whose event stream ends (or the socket closes) before it is ready."""

    close_code = 1006

    def __init__(self, ws, *, raises: bool):
        self._ws = ws
        self._raises = raises
        self.disconnected = False

    async def events(self):
        if self._raises:
            from websockets.exceptions import ConnectionClosed
            from websockets.frames import Close

            raise ConnectionClosed(Close(1006, ""), None)
        return
        yield  # an async generator that ends at once

    async def disconnect(self):
        self.disconnected = True
        await self._ws.close()


@pytest.mark.parametrize("raises", [True, False], ids=["connection-closed", "stream-end"])
async def test_a_session_that_ends_before_ready_is_unreachable(
    user_client, fake_realtime_server, monkeypatch, raises
):
    sessions: list[_EarlyEndSession] = []

    def attach(spec, ws, protocol, pending):
        sessions.append(_EarlyEndSession(ws, raises=raises))
        return sessions[-1]

    monkeypatch.setattr(connection_check, "attach_session", attach)
    agent_id = await agent_for(user_client, fake_realtime_server.url)
    response = await user_client.post(f"/api/agents/{agent_id}/test")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["reachable"], body["latencyMs"]) == (False, None)
    assert body["log"][-1] == {
        "ok": False,
        "message": "The agent closed the connection before the session was ready",
    }
    assert sessions[0].disconnected


async def test_a_failing_close_still_reports_a_reachable_agent(
    user_client, fake_realtime_server, monkeypatch
):
    async def broken_close(session, reader, *, timeout_s):
        raise RuntimeError("close exploded")

    monkeypatch.setattr(connection_check, "close_session", broken_close)
    agent_id = await agent_for(user_client, fake_realtime_server.url)
    response = await user_client.post(f"/api/agents/{agent_id}/test")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reachable"] is True
    assert body["log"][-1] == {"ok": False, "message": "Close failed (RuntimeError)"}
    await fake_realtime_server.closed.wait()  # the socket was still disconnected


async def test_an_unreadable_close_code_does_not_raise(
    user_client, fake_realtime_server, monkeypatch
):
    real_attach = connection_check.attach_session

    class NoCloseCode:
        def __init__(self, inner):
            self._inner = inner

        def __getattr__(self, name):
            return getattr(self._inner, name)

        @property
        def close_code(self):
            raise RuntimeError("no close code")

    monkeypatch.setattr(
        connection_check,
        "attach_session",
        lambda *args: NoCloseCode(real_attach(*args)),
    )
    agent_id = await agent_for(user_client, fake_realtime_server.url)
    body = (await user_client.post(f"/api/agents/{agent_id}/test")).json()
    assert body["reachable"] is True
    assert body["log"][-1] == {"ok": True, "message": "Closed"}


@pytest.fixture
async def relay_server():
    """A relay that answers `ready`, or an `error` for the session id `gone`."""
    from websockets.asyncio.server import serve

    async def handler(ws):
        if "session_id=gone" in ws.request.path:
            await ws.send(json.dumps({"type": "error", "message": "Session not found or ended"}))
            await ws.close()
            return
        await ws.send(json.dumps({"type": "ready"}))
        async for message in ws:
            if json.loads(message)["type"] == "stop":
                await ws.send(json.dumps({"type": "closed", "reason": "stopped"}))
                await ws.close()

    async with serve(handler, "127.0.0.1", 0) as server:
        yield f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/api/voice"


async def test_a_relay_agent_is_reachable(user_client, relay_server):
    agent_id = await agent_for(
        user_client, relay_server, protocol="relay", channelId=None, userId=None
    )
    body = (await user_client.post(f"/api/agents/{agent_id}/test")).json()
    assert (body["reachable"], body["protocol"]) == (True, "relay")
    assert messages(body)[0].startswith("Dialing ws://127.0.0.1:")
    assert all(line["ok"] for line in body["log"])


async def test_a_relay_error_before_ready_is_unreachable(user_client, relay_server, monkeypatch):
    monkeypatch.setattr(connection_check, "TEST_THREAD_ID", "gone")
    agent_id = await agent_for(
        user_client, relay_server, protocol="relay", channelId=None, userId=None
    )
    body = (await user_client.post(f"/api/agents/{agent_id}/test")).json()
    assert body["reachable"] is False
    assert messages(body)[-1] == "The agent answered with an error: Session not found or ended"


async def test_a_relay_session_url_that_fails_is_unreachable(
    user_client, relay_server, monkeypatch
):
    async def refuse(session_url, origin):
        raise connection_check.SessionCreateError("the session URL answered 429")

    monkeypatch.setattr("voice_eval.targets.detect.create_session", refuse)
    agent_id = await agent_for(
        user_client,
        relay_server,
        protocol="relay",
        channelId=None,
        userId=None,
        sessionUrl="http://127.0.0.1/api/sessions",
    )
    body = (await user_client.post(f"/api/agents/{agent_id}/test")).json()
    assert body["reachable"] is False
    assert messages(body) == [
        "Creating a session at http://127.0.0.1/api/sessions",
        "Could not create the session: the session URL answered 429",
    ]
