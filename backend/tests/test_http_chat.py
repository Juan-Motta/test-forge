"""HTTP chat target (Vivi channel API): invoke and the non-standard `data:` line stream.

Every request goes to an in-process `httpx.MockTransport`; nothing reaches the network.
"""

import json
import uuid

import httpx
import pytest

from voice_eval.ports.text_target import (
    ReplyEnded,
    TextDelta,
    TextTargetError,
    ToolEnded,
    ToolStarted,
    collect,
)
from voice_eval.targets.http_chat import HttpChatTarget

BASE = "https://vivi.example.com/api"
CHANNEL = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"
THREAD = str(uuid.uuid4())


def line(**fields) -> str:
    message = {"message": "", "event": None, "type": None, "category": None, "metadata": None}
    return "data: " + json.dumps({**message, **fields}) + "\n"


STREAM = (
    line(event="on_chat_model_start")
    + line(message="thinking hard", event="on_chat_model_stream", type="reasoning")
    + line(
        event="on_tool_start",
        type="tool_start",
        category="status",
        metadata={"toolName": "lookup_balance", "args": {}},
    )
    + line(
        event="on_tool_end",
        type="tool_end",
        category="status",
        metadata={"toolName": "lookup_balance", "success": True, "elapsedMs": 412},
    )
    + "\n"  # a blank line is tolerated
    + line(message="Your balance ", event="on_chat_model_stream").replace("\n", "\r\n")
    + line(event="on_chat_model_end")
    + line(event="on_chat_model_start")
    + line(message="is $10.", event="on_chat_model_stream")
    + line(type="sources", category="message", metadata={"sources": []})
    + line(event="on_chat_end")
)


class Recorder:
    def __init__(self, handler) -> None:
        self.requests: list[httpx.Request] = []
        self.handler = handler

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)


def target(handler, **overrides) -> tuple[HttpChatTarget, Recorder]:
    recorder = Recorder(handler)
    fields = {
        "base_url": BASE,
        "channel_id": CHANNEL,
        "mode": "stream",
        "transport": httpx.MockTransport(recorder),
    }
    return HttpChatTarget(**{**fields, **overrides}), recorder


def streaming(body: str, status: int = 200):
    return lambda _: httpx.Response(
        status, content=body.encode(), headers={"content-type": "text/event-stream"}
    )


async def events_of(chat: HttpChatTarget, message: str = "Hi") -> list:
    return [event async for event in chat.send(message, thread_id=THREAD)]


async def test_stream_joins_text_deltas_and_surfaces_tools():
    chat, recorder = target(streaming(STREAM))
    events = await events_of(chat, "What is my balance?")

    texts = [event.text for event in events if isinstance(event, TextDelta)]
    assert texts == ["Your balance ", "is $10."]  # reasoning skipped
    assert ToolStarted(name="lookup_balance") in events
    assert ToolEnded(name="lookup_balance", success=True, elapsed_ms=412) in events
    end = events[-1]
    assert isinstance(end, ReplyEnded)
    assert end.text == "Your balance is $10."
    assert end.first_text_ms is not None and 0 <= end.first_text_ms <= end.total_ms

    (request,) = recorder.requests
    assert request.method == "POST"
    assert str(request.url) == f"{BASE}/channelsApi/{CHANNEL}/stream"
    assert json.loads(request.content) == {"message": "What is my balance?", "threadId": THREAD}
    assert "vivi-api-key" not in request.headers
    assert "origin" not in request.headers


async def test_collect_returns_the_reply_with_timings_and_tools():
    chat, _ = target(streaming(STREAM))
    reply = await collect(chat.send("Hi", thread_id=THREAD))
    assert reply.text == "Your balance is $10."
    assert reply.tools == ("lookup_balance",)
    assert reply.first_text_ms is not None and reply.total_ms >= reply.first_text_ms


async def test_api_key_and_origin_headers_only_when_configured():
    chat, recorder = target(
        streaming(STREAM), api_key="vk-secret-123456", origin="https://portal.example.com"
    )
    await events_of(chat)
    headers = recorder.requests[0].headers
    assert headers["vivi-api-key"] == "vk-secret-123456"
    assert headers["origin"] == "https://portal.example.com"


async def test_stream_without_chat_end_is_an_error():
    body = line(message="Partial", event="on_chat_model_stream")
    chat, _ = target(streaming(body))
    with pytest.raises(TextTargetError, match="ended before the reply finished"):
        await events_of(chat)


async def test_malformed_stream_line_is_an_error():
    chat, _ = target(streaming("data: {not json\n"))
    with pytest.raises(TextTargetError, match="malformed"):
        await events_of(chat)


async def test_invoke_returns_the_full_message():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"message": "Hello there.", "event": None, "type": None})

    chat, recorder = target(handler, mode="invoke")
    events = await events_of(chat)
    assert events[0] == TextDelta(text="Hello there.")
    end = events[-1]
    assert isinstance(end, ReplyEnded)
    assert end.text == "Hello there."
    assert end.first_text_ms == end.total_ms
    assert str(recorder.requests[0].url) == f"{BASE}/channelsApi/{CHANNEL}/invoke"


async def test_invoke_reply_that_is_not_a_message_is_an_error():
    chat, _ = target(lambda _: httpx.Response(200, json={"nope": 1}), mode="invoke")
    with pytest.raises(TextTargetError, match="not a valid message"):
        await events_of(chat)


@pytest.mark.parametrize(
    ("status", "mode", "fragment"),
    [
        (401, "stream", "rejected the API key"),
        (403, "stream", "subscription"),
        (404, "invoke", "not found"),
        (409, "stream", "response schema"),
        (422, "invoke", "threadId"),
        (503, "stream", "HTTP 503"),
        (418, "invoke", "HTTP 418"),
    ],
)
async def test_http_errors_have_clear_messages_without_the_body(status, mode, fragment):
    leak = "LEAKCANARY-body"
    chat, _ = target(lambda _: httpx.Response(status, text=leak), mode=mode)
    with pytest.raises(TextTargetError) as caught:
        await events_of(chat)
    assert fragment in str(caught.value)
    assert leak not in str(caught.value)
    assert caught.value.status == status


async def test_connection_failure_is_a_clear_error():
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    chat, _ = target(refuse)
    with pytest.raises(TextTargetError, match="Could not connect"):
        await events_of(chat)


async def test_read_timeout_is_a_clear_error():
    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    chat, _ = target(slow)
    with pytest.raises(TextTargetError, match="No answer"):
        await events_of(chat)


async def test_the_egress_guard_refuses_private_addresses_without_connecting():
    # no transport: the real guarded transport; a loopback literal is refused before any connect
    chat = HttpChatTarget(base_url="http://127.0.0.1:9", channel_id=CHANNEL, mode="invoke")
    with pytest.raises(TextTargetError, match="private or local"):
        await events_of(chat)
