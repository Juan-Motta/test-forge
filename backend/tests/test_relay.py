"""The JSON voice relay adapter, against a local server speaking that protocol."""

import base64
import json
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from websockets.asyncio.server import serve

from voice_eval.ports.target import AudioDelta, Closed, Ready, ServerError, TranscriptUpdate
from voice_eval.targets.detect import TargetSpec, open_target
from voice_eval.targets.relay import SessionCreateError, create_session

PCM = b"\x01\x00\x02\x00"
B64 = base64.b64encode(PCM).decode()


@pytest.fixture
async def relay_server():
    """Answers like the relay: ready, then an agent answer to the first caller audio."""
    seen: dict = {"paths": [], "origins": [], "received": []}

    async def handler(ws):
        seen["paths"].append(ws.request.path)
        seen["origins"].append(ws.request.headers.get("origin"))
        await ws.send(json.dumps({"type": "ready"}))
        async for message in ws:
            frame = json.loads(message)
            seen["received"].append(frame)
            if frame["type"] == "audio" and len(seen["received"]) == 1:
                for event in (
                    {"type": "user_done", "text": "hola"},
                    {"type": "agent_transcript", "delta": "Hola, "},
                    {"type": "audio", "audio": B64},
                    {"type": "agent_transcript", "delta": "soy Juan."},
                    {"type": "agent_done", "text": "Hola, soy Juan."},
                    {"type": "turn", "tokens": 12, "cost_usd": 0.001},
                ):
                    await ws.send(json.dumps(event))
            elif frame["type"] == "stop":
                await ws.send(json.dumps({"type": "closed", "reason": "stopped"}))
                await ws.close()

    async with serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        yield f"ws://127.0.0.1:{port}/api/voice", seen


async def test_a_call_over_the_relay(relay_server):
    url, seen = relay_server
    spec = TargetSpec(url, "", "", thread_id="t-1", origin="https://raaw.dev", protocol="relay")
    session = await open_target(spec)
    assert session.protocol == "relay"
    assert (session.agent_speaks_first, session.explicit_turn_end) == (False, False)
    assert not session.supports_text and not session.supports_playback_interruption
    events = session.events()

    assert await anext(events) == Ready(session_id="t-1", raw={"type": "ready"})
    await session.send_caller_audio(PCM)
    received = [await anext(events) for _ in range(6)]
    audio = [event for event in received if isinstance(event, AudioDelta)]
    assert [event.pcm for event in audio] == [PCM]
    captions = [(e.role, e.text) for e in received if isinstance(e, TranscriptUpdate)]
    assert captions == [
        ("user", "hola"),
        ("assistant", "Hola, "),
        ("assistant", "Hola, soy Juan."),
        ("assistant", "Hola, soy Juan."),
    ]
    assert [(m.role, m.text) for m in session.transcript_messages()] == [
        ("user", "hola"),
        ("assistant", "Hola, soy Juan."),
    ]

    assert await session.close() == {"type": "stop"}
    assert isinstance(await anext(events), Closed)
    assert [frame async for frame in events] == []
    # The session id is the thread id when there is no session URL; the Origin is sent.
    assert parse_qs(urlsplit(seen["paths"][0]).query) == {"session_id": ["t-1"]}
    assert seen["origins"] == ["https://raaw.dev"]
    assert seen["received"] == [{"type": "audio", "audio": B64}, {"type": "stop"}]


async def test_the_next_answer_is_a_new_message(relay_server):
    url, _ = relay_server
    session = await open_target(TargetSpec(url, "", "", protocol="relay"))
    for event in (
        {"type": "agent_transcript", "delta": "Uno"},
        {"type": "agent_done", "text": "Uno."},
        {"type": "agent_transcript", "delta": "Dos"},
    ):
        session.parse(event)
    assert [m.text for m in session.transcript_messages()] == ["Uno.", "Dos"]
    await session.disconnect()


async def test_an_error_before_ready_is_a_server_error(relay_server):
    url, _ = relay_server
    session = await open_target(TargetSpec(url, "", "", protocol="relay"))
    event = session.parse({"type": "error", "message": "Session not found or ended"})
    assert event == ServerError(
        message="Session not found or ended",
        raw={"type": "error", "message": "Session not found or ended"},
    )
    await session.disconnect()


async def test_the_session_url_gives_the_session_id(relay_server, monkeypatch):
    url, seen = relay_server
    calls = []

    async def created(session_url, origin):
        calls.append((session_url, origin))
        return "s-42"

    monkeypatch.setattr("voice_eval.targets.detect.create_session", created)
    spec = TargetSpec(
        url,
        "",
        "",
        origin="https://raaw.dev",
        protocol="relay",
        session_url="https://agent.raaw.dev/api/sessions",
    )
    session = await open_target(spec)
    assert calls == [("https://agent.raaw.dev/api/sessions", "https://raaw.dev")]
    assert session.thread_id == "s-42"
    assert await anext(session.events()) == Ready(session_id="s-42", raw={"type": "ready"})
    assert parse_qs(urlsplit(seen["paths"][0]).query) == {"session_id": ["s-42"]}
    await session.disconnect()


def _transport(status: int, body: object) -> tuple[httpx.MockTransport, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handle), requests


async def test_create_session_posts_an_empty_object_with_the_origin():
    transport, requests = _transport(200, {"session_id": "abc"})
    session_id = await create_session(
        "https://x.test/api/sessions", "https://x.test", transport=transport
    )
    assert session_id == "abc"
    assert (requests[0].method, json.loads(requests[0].content)) == ("POST", {})
    assert requests[0].headers["origin"] == "https://x.test"


@pytest.mark.parametrize(
    ("status", "body", "message"),
    [
        (429, {"detail": "Too many requests"}, "the session URL answered 429"),
        (200, {"id": "abc"}, 'the session URL answered without a "session_id"'),
        (200, ["abc"], 'the session URL answered without a "session_id"'),
    ],
)
async def test_create_session_refuses_what_gives_no_session(status, body, message):
    transport, _ = _transport(status, body)
    with pytest.raises(SessionCreateError, match=message):
        await create_session("https://x.test/api/sessions", None, transport=transport)


async def test_an_unreachable_session_url_is_a_connection_error():
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with pytest.raises(ConnectionError, match="could not be reached"):
        await create_session("https://x.test/s", None, transport=httpx.MockTransport(refuse))
