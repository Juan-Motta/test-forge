import json
from urllib.parse import parse_qs, urlsplit

import pytest

from voice_eval.ports.target import (
    AgentBusy,
    AudioDelta,
    NotSupportedError,
    Ready,
    ResponseDone,
    ResponseStarted,
    ServerError,
)
from voice_eval.targets.detect import TargetSpec, open_target
from voice_eval.targets.vivi_live import ViviLiveClient
from voice_eval.targets.vivi_realtime import (
    CLIENT_EVENT_TYPES,
    RealtimeTranscript,
    ViviRealtimeClient,
)


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.close_codes: list[int] = []

    async def send(self, message: str) -> None:
        self.sent.append(json.loads(message))

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.close_codes.append(code)


def _client() -> tuple[ViviRealtimeClient, FakeSocket]:
    client = ViviRealtimeClient("wss://h", "chan-1", "user-1", thread_id="t-1")
    ws = FakeSocket()
    client.attach(ws)  # type: ignore[arg-type]
    return client, ws


def test_realtime_uses_the_same_endpoint_url_as_live():
    rt = ViviRealtimeClient("wss://h/", "chan-1", "user-1", thread_id="t-1")
    live = ViviLiveClient("wss://h", "chan-1", "user-1", thread_id="t-1")
    assert rt.url == live.url
    assert parse_qs(urlsplit(rt.url).query)["voiceCapability"] == ["live-v1"]


def test_normalizes_session_response_audio_and_tool_events():
    client, _ = _client()
    created = {"type": "session.created", "session": {"id": "sess_1", "model": "gpt-rt"}}
    assert not isinstance(client.normalize(created), Ready)
    assert (client.session_id, client.model) == ("sess_1", "gpt-rt")
    ready = client.normalize({"type": "session.updated", "session": {}})
    assert ready == Ready(session_id="sess_1", raw=ready.raw)
    assert not isinstance(client.normalize({"type": "session.updated"}), Ready)  # only once
    assert isinstance(
        client.normalize({"type": "response.created", "turn_id": "x"}), ResponseStarted
    )
    assert isinstance(client.normalize({"type": "response.done"}), ResponseDone)
    delta = client.normalize({"type": "response.output_audio.delta", "delta": "AAA="})
    assert isinstance(delta, AudioDelta) and delta.pcm == b"\x00\x00"
    for busy in (
        {"type": "response.processing"},
        {"type": "response.processing.done"},
        {"type": "response.function_call_arguments.delta", "delta": "{"},
        {"type": "response.output_item.added", "item": {"type": "function_call"}},
    ):
        assert isinstance(client.normalize(busy), AgentBusy), busy
    message_item = {"type": "response.output_item.added", "item": {"type": "message"}}
    assert not isinstance(client.normalize(message_item), AgentBusy)
    error = client.normalize({"type": "error", "error": {"type": "rate_limit_exhausted"}})
    assert isinstance(error, ServerError) and "rate_limit_exhausted" in error.message


def test_transcript_orders_by_conversation_items_and_keeps_text_turns_once():
    t = RealtimeTranscript()
    t.on_item({"id": "sys", "type": "message", "role": "system", "content": []})
    t.record_sent_text("hello there")
    t.on_item(
        {
            "id": "item_u1",
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "hello there"}],
        }
    )
    t.on_item({"id": "item_a1", "type": "message", "role": "assistant", "content": []})
    t.append_delta("item_a1", "Hi ")
    t.append_delta("item_a1", "you")
    t.on_item({"id": "item_u2", "type": "message", "role": "user", "content": []})
    t.on_item({"id": "item_a2", "type": "message", "role": "assistant", "content": []})
    t.set_text("item_a2", "second answer", role="assistant")
    t.append_delta("item_a2", " late delta ignored")
    t.set_text("item_u2", "spoken question", role="user")
    assert [(m.role, m.message_id, m.text) for m in t.messages()] == [
        ("user", "item_u1", "hello there"),
        ("assistant", "item_a1", "Hi you"),
        ("user", "item_u2", "spoken question"),
        ("assistant", "item_a2", "second answer"),
    ]


async def test_client_sends_only_allow_listed_events():
    client, ws = _client()
    await client.send_caller_audio(b"\x01\x00" * 10)
    await client.send_caller_text("hola")
    await client.request_agent_turn()
    assert [m["type"] for m in ws.sent] == [
        "input_audio_buffer.append",
        "conversation.item.create",
        "response.create",
        "response.create",
    ]
    assert ws.sent[1]["item"] == {
        "type": "message",
        "role": "user",
        "content": [{"type": "input_text", "text": "hola"}],
    }
    assert all(m["type"] in CLIENT_EVENT_TYPES for m in ws.sent)
    with pytest.raises(ValueError):
        await client.send_event({"type": "voice.close"})
    with pytest.raises(ValueError):
        await client.send_caller_audio(b"")
    record = await client.close()
    assert ws.close_codes == [1000]
    assert record == {"type": "websocket.close", "code": 1000}
    assert all(m["type"] in CLIENT_EVENT_TYPES for m in ws.sent)


async def test_live_rejects_text_turns_and_agent_turn_requests():
    client = ViviLiveClient("wss://h", "c", "u")
    assert not client.supports_text
    with pytest.raises(NotSupportedError):
        await client.send_caller_text("hola")


async def test_auto_detects_live(fake_live_server):
    spec = TargetSpec(fake_live_server.url, "chan", "user")
    session = await open_target(spec, detect_timeout_s=5)
    try:
        assert isinstance(session, ViviLiveClient)
        assert session.protocol == "live" and session.thread_id == spec.thread_id
        first = [event async for event in _take(session, 2)]
        assert [e.raw["type"] for e in first] == ["voice.protocol", "voice.ready"]
    finally:
        await session.disconnect()


async def test_auto_detects_realtime(fake_realtime_server):
    spec = TargetSpec(fake_realtime_server.url, "chan", "user", protocol="auto")
    session = await open_target(spec, detect_timeout_s=5)
    try:
        assert isinstance(session, ViviRealtimeClient)
        assert session.protocol == "realtime" and not session.agent_speaks_first
        first = [event async for event in _take(session, 2)]
        assert [e.raw["type"] for e in first] == ["session.created", "session.updated"]
        assert session.model == "gpt-realtime-2.1"
    finally:
        await session.disconnect()


async def test_explicit_protocol_skips_detection(fake_realtime_server):
    spec = TargetSpec(fake_realtime_server.url, "chan", "user", protocol="realtime")
    session = await open_target(spec, detect_timeout_s=5)
    try:
        assert isinstance(session, ViviRealtimeClient)
        first = [event async for event in _take(session, 1)]
        assert first[0].raw["type"] == "session.created"
    finally:
        await session.disconnect()


async def _take(session, n):
    count = 0
    async for event in session.events():
        yield event
        count += 1
        if count == n:
            return
