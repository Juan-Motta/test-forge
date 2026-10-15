"""The OpenAI Realtime (GA) caller adapter against an in-process fake WebSocket server.

Every test dials 127.0.0.1: no provider is ever contacted.
"""

import asyncio
import base64
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import pytest
from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Response

from voice_eval.ports.realtime_caller import (
    CallerAudio,
    CallerTranscript,
    CallerTranscriptDelta,
    HangUp,
    RealtimeCallerError,
)
from voice_eval.providers.openai_realtime_caller import OpenAIRealtimeCaller, session_config

KEY = "sk-realtime-abcdefghijkl"
AUDIO = b"\x10\x00" * 2400  # 100 ms


def audio_events(rid: str, pcm: bytes, transcript: str) -> list[dict[str, Any]]:
    delta = base64.b64encode(pcm).decode()
    return [
        {
            "type": "response.output_audio.delta",
            "response_id": rid,
            "item_id": "i1",
            "delta": delta,
        },
        {
            "type": "response.output_audio.delta",
            "response_id": rid,
            "item_id": "i1",
            "delta": delta,
        },
        {
            "type": "response.output_audio_transcript.done",
            "response_id": rid,
            "item_id": "i1",
            "transcript": transcript,
        },
    ]


@dataclass
class FakeRealtimeModel:
    """Answers `session.update` and plays one scripted response per `response.create`."""

    responses: list[list[dict[str, Any]]] = field(default_factory=list)
    reject_reasoning: bool = False
    reject_with_status: int | None = None
    received: list[dict[str, Any]] = field(default_factory=list)
    paths: list[str] = field(default_factory=list)
    headers: list[Headers] = field(default_factory=list)
    hold_response: asyncio.Event | None = None  # stream up to `hold_at`, then wait for it
    hold_at: int = 0
    reject_cleanup: bool = False  # answer item deletes and truncates with an error
    url: str = ""
    _created: int = 0

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [m for m in self.received if m["type"] == kind]

    def types(self) -> list[str]:
        return [m["type"] for m in self.received]

    def process_request(self, connection, request):
        self.paths.append(request.path)
        self.headers.append(request.headers)
        if self.reject_with_status is not None:
            body = f'{{"error": {{"message": "Incorrect API key provided: {KEY}"}}}}'.encode()
            return Response(self.reject_with_status, "Unauthorized", Headers(), body)
        return None

    async def handler(self, ws: ServerConnection) -> None:
        await ws.send(json.dumps({"type": "session.created", "session": {}}))
        async for raw in ws:
            msg = json.loads(raw)
            self.received.append(msg)
            match msg["type"]:
                case "session.update":
                    if self.reject_reasoning and "reasoning" in msg["session"]:
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "error",
                                    "error": {
                                        "type": "invalid_request_error",
                                        "code": "unknown_parameter",
                                        "message": "Unknown parameter: 'session.reasoning'.",
                                        "param": "session.reasoning",
                                    },
                                }
                            )
                        )
                    else:
                        await ws.send(json.dumps({"type": "session.updated", "session": {}}))
                case "response.create":
                    asyncio.create_task(self._respond(ws))
                case "response.cancel":
                    pass
                case "conversation.item.delete" | "conversation.item.truncate":
                    if self.reject_cleanup:
                        error = {
                            "type": "invalid_request_error",
                            "code": "item_not_found",
                            "event_id": msg.get("event_id"),
                        }
                        await ws.send(json.dumps({"type": "error", "error": error}))

    async def _respond(self, ws: ServerConnection) -> None:
        self._created += 1
        rid = f"resp_{self._created}"
        script = self.responses.pop(0) if self.responses else []
        await ws.send(json.dumps({"type": "response.created", "response": {"id": rid}}))
        for n, event in enumerate(script):
            await ws.send(json.dumps({**event, "response_id": rid}))
            if n == self.hold_at and self.hold_response is not None:
                await self.hold_response.wait()
        await ws.send(
            json.dumps({"type": "response.done", "response": {"id": rid, "status": "completed"}})
        )


@pytest.fixture
async def model():
    fake = FakeRealtimeModel()
    async with serve(fake.handler, "127.0.0.1", 0, process_request=fake.process_request) as srv:
        port = srv.sockets[0].getsockname()[1]
        fake.url = f"http://127.0.0.1:{port}"
        yield fake


def openai_caller(model: FakeRealtimeModel, **kwargs: Any) -> OpenAIRealtimeCaller:
    return OpenAIRealtimeCaller.for_openai(
        KEY, model="gpt-realtime-2.1-mini", voice="marin", base_url=f"{model.url}/v1", **kwargs
    )


async def collect(caller: OpenAIRealtimeCaller, note: str | None = None) -> list[Any]:
    return [event async for event in caller.respond(note)]


def test_openai_and_azure_urls_and_auth_headers():
    openai = OpenAIRealtimeCaller.for_openai(KEY, model="gpt-realtime-2.1-mini", voice="coral")
    assert openai.url == "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini"
    assert openai.headers == {"Authorization": f"Bearer {KEY}"}
    assert openai.voice == "coral"

    azure = OpenAIRealtimeCaller.for_azure(
        KEY, endpoint="https://res.openai.azure.com/", deployment="rt-mini", voice="verse"
    )
    assert azure.url == "wss://res.openai.azure.com/openai/v1/realtime?model=rt-mini"
    assert azure.headers == {"api-key": KEY}
    assert KEY not in repr(azure) and KEY not in repr(openai)


def test_the_session_turns_server_vad_off_and_offers_hang_up():
    config = session_config("Be Ana.", "cedar", reasoning=True)
    assert config["type"] == "realtime"
    assert config["instructions"] == "Be Ana."
    assert config["output_modalities"] == ["audio"]
    pcm = {"type": "audio/pcm", "rate": 24000}
    assert config["audio"]["input"] == {"format": pcm, "turn_detection": None}
    assert config["audio"]["output"] == {"format": pcm, "voice": "cedar"}
    (tool,) = config["tools"]
    assert (tool["type"], tool["name"]) == ("function", "hang_up")
    assert tool["parameters"]["required"] == ["reason"]
    assert config["reasoning"] == {"effort": "low"}
    assert "reasoning" not in session_config("Be Ana.", "cedar", reasoning=False)


async def test_open_configures_the_session_over_the_openai_path(model):
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    try:
        assert model.paths == ["/v1/realtime?model=gpt-realtime-2.1-mini"]
        assert model.headers[0]["Authorization"] == f"Bearer {KEY}"
        (update,) = model.of("session.update")
        assert update["session"] == session_config("You are Ana.", "marin", reasoning=True)
    finally:
        await caller.close()


async def test_open_retries_without_reasoning_when_the_model_refuses_it(model):
    model.reject_reasoning = True
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    await caller.close()
    first, second = model.of("session.update")
    assert "reasoning" in first["session"] and "reasoning" not in second["session"]


async def test_the_azure_path_uses_the_deployment_and_the_api_key_header(model):
    caller = OpenAIRealtimeCaller.for_azure(KEY, endpoint=model.url, deployment="rt", voice="ash")
    await caller.open("You are Ana.")
    await caller.close()
    assert model.paths == ["/openai/v1/realtime?model=rt"]
    assert model.headers[0]["api-key"] == KEY
    assert "Authorization" not in model.headers[0]


async def test_a_refused_connection_fails_with_a_safe_message(model):
    model.reject_with_status = 401
    caller = openai_caller(model)
    with pytest.raises(RealtimeCallerError) as raised:
        await caller.open("You are Ana.")
    assert "401" in str(raised.value)
    assert KEY not in str(raised.value) and model.url not in str(raised.value)


async def test_an_unreachable_model_fails_with_a_safe_message(unused_tcp_port):
    caller = OpenAIRealtimeCaller.for_openai(
        KEY, model="m", voice="alloy", base_url=f"http://127.0.0.1:{unused_tcp_port}/v1"
    )
    with pytest.raises(RealtimeCallerError) as raised:
        await caller.open("You are Ana.")
    assert KEY not in str(raised.value) and "127.0.0.1" not in str(raised.value)


async def test_a_response_commits_what_was_heard_and_streams_the_answer(model):
    model.responses = [
        [
            *audio_events("", AUDIO, "Hi, I need a room."),
            {
                "type": "response.function_call_arguments.done",
                "call_id": "call_1",
                "name": "hang_up",
                "arguments": json.dumps({"reason": "goal met"}),
            },
        ]
    ]
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    try:
        await caller.append(AUDIO)
        await caller.append(AUDIO[:480])
        events = await collect(caller, note="You interrupted the agent.")
        await caller.tool_output("call_1", "the call is over")
        await asyncio.sleep(0.05)
    finally:
        await caller.close()

    assert events == [
        CallerAudio(AUDIO),
        CallerAudio(AUDIO),
        CallerTranscript("Hi, I need a room."),
        HangUp("call_1", "goal met"),
    ]
    assert model.types()[1:] == [
        "input_audio_buffer.append",
        "input_audio_buffer.append",
        "input_audio_buffer.commit",
        "conversation.item.create",
        "response.create",
        "conversation.item.create",
    ]
    appended = b"".join(base64.b64decode(m["audio"]) for m in model.of("input_audio_buffer.append"))
    assert appended == AUDIO + AUDIO[:480]
    note, output = model.of("conversation.item.create")
    assert note["item"] == {
        "type": "message",
        "role": "system",
        "content": [{"type": "input_text", "text": "You interrupted the agent."}],
    }
    assert output["item"] == {
        "type": "function_call_output",
        "call_id": "call_1",
        "output": "the call is over",
    }


@pytest.mark.parametrize(
    "prefix", ["response.output_audio_transcript", "response.audio_transcript"]
)
async def test_the_spoken_words_stream_as_transcript_deltas(model, prefix):
    pcm = base64.b64encode(AUDIO).decode()
    model.responses = [
        [
            {"type": f"{prefix}.delta", "item_id": "i1", "delta": "Hi, I "},
            {"type": "response.output_audio.delta", "item_id": "i1", "delta": pcm},
            {"type": f"{prefix}.delta", "item_id": "i1", "delta": "need a room."},
            {"type": f"{prefix}.delta", "item_id": "i1", "delta": ""},
            {"type": f"{prefix}.done", "item_id": "i1", "transcript": " Hi, I need a room. "},
        ]
    ]
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    try:
        events = await collect(caller)
    finally:
        await caller.close()

    assert events == [
        CallerTranscriptDelta("Hi, I "),
        CallerAudio(AUDIO),
        CallerTranscriptDelta("need a room."),
        CallerTranscript("Hi, I need a room."),
    ]


async def test_a_short_buffer_is_padded_to_the_minimum_commit(model):
    model.responses = [audio_events("", AUDIO, "Hello.")]
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    await caller.append(b"\x10\x00" * 240)  # 10 ms
    await collect(caller)
    await caller.close()
    appended = b"".join(base64.b64decode(m["audio"]) for m in model.of("input_audio_buffer.append"))
    assert len(appended) == len(AUDIO)  # padded with silence to 100 ms
    assert appended.startswith(b"\x10\x00" * 240) and not any(appended[480:])


async def test_nothing_heard_means_no_commit(model):
    model.responses = [audio_events("", AUDIO, "Hello.")]
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    events = await collect(caller, note="You speak first.")
    await caller.close()
    assert events[-1] == CallerTranscript("Hello.")
    assert "input_audio_buffer.commit" not in model.types()


async def test_an_error_during_a_response_fails_without_the_provider_message(model):
    model.responses = [
        [
            {
                "type": "error",
                "error": {
                    "type": "invalid_request_error",
                    "code": "model_not_found",
                    "message": f"The model does not exist ({KEY})",
                },
            }
        ]
    ]
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    with pytest.raises(RealtimeCallerError) as raised:
        await collect(caller)
    await caller.close()
    assert "model_not_found" in str(raised.value)
    assert KEY not in str(raised.value)


async def test_a_failed_response_status_is_an_error(model):
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    original = model._respond

    async def failed(ws):
        await ws.send(json.dumps({"type": "response.created", "response": {"id": "r9"}}))
        await ws.send(
            json.dumps(
                {
                    "type": "response.done",
                    "response": {
                        "id": "r9",
                        "status": "failed",
                        "status_details": {"error": {"code": "rate_limit_exceeded"}},
                    },
                }
            )
        )

    model._respond = failed
    try:
        with pytest.raises(RealtimeCallerError, match="rate_limit_exceeded"):
            await collect(caller)
    finally:
        model._respond = original
        await caller.close()


async def test_closing_a_response_early_cancels_it_and_ignores_its_rest(model):
    model.hold_response = asyncio.Event()
    model.responses = [audio_events("", AUDIO, "stale words"), audio_events("", AUDIO, "Fresh.")]
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    stream = caller.respond()
    assert await anext(stream) == CallerAudio(AUDIO)
    await stream.aclose()
    model.hold_response.set()
    model.hold_response = None
    try:
        events = await asyncio.wait_for(collect(caller), 5)
    finally:
        await caller.close()
    assert "response.cancel" in model.types()
    assert events == [CallerAudio(AUDIO), CallerAudio(AUDIO), CallerTranscript("Fresh.")]


async def test_a_closed_connection_fails_the_response(model):
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    original: Callable = model._respond

    async def hang(ws):
        await ws.close(1011)

    model._respond = hang
    try:
        with pytest.raises(RealtimeCallerError, match="closed"):
            await asyncio.wait_for(collect(caller), 5)
    finally:
        model._respond = original
        await caller.close()


def item_added(item_id: str) -> dict[str, Any]:
    return {
        "type": "response.output_item.added",
        "output_index": 0,
        "item": {"id": item_id, "type": "message", "role": "assistant", "content": []},
    }


@pytest.mark.parametrize("reject_cleanup", [False, True])
async def test_a_response_discarded_before_its_audio_is_deleted_from_the_conversation(
    model, reject_cleanup
):
    model.hold_response = asyncio.Event()
    model.reject_cleanup = reject_cleanup
    model.responses = [
        [item_added("item_stale"), *audio_events("", AUDIO, "stale words")],
        audio_events("", AUDIO, "Fresh."),
    ]
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    stream = caller.respond()
    pending = asyncio.ensure_future(anext(stream))
    await asyncio.sleep(0.2)  # the item was added; no audio yet
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    await stream.aclose()
    model.hold_response.set()
    model.hold_response = None
    try:
        events = await asyncio.wait_for(collect(caller), 5)
    finally:
        await caller.close()

    assert events == [CallerAudio(AUDIO), CallerAudio(AUDIO), CallerTranscript("Fresh.")]
    (delete,) = model.of("conversation.item.delete")
    assert delete["item_id"] == "item_stale"
    types = model.types()
    assert types.index("response.cancel") < types.index("conversation.item.delete")
    assert types.index("conversation.item.delete") < len(types) - 1 - types[::-1].index(
        "response.create"
    )
    assert "conversation.item.truncate" not in types


async def test_a_response_cut_after_some_audio_is_truncated_to_what_was_played(model):
    model.hold_response = asyncio.Event()
    model.hold_at = 1
    model.responses = [
        [
            item_added("item_cut"),
            {
                "type": "response.output_audio.delta",
                "item_id": "item_cut",
                "delta": base64.b64encode(AUDIO).decode(),
            },
            {
                "type": "response.output_audio.delta",
                "item_id": "item_cut",
                "delta": base64.b64encode(AUDIO).decode(),
            },
        ],
        audio_events("", AUDIO, "Fresh."),
    ]
    caller = openai_caller(model)
    await caller.open("You are Ana.")
    stream = caller.respond()
    assert await anext(stream) == CallerAudio(AUDIO)
    await stream.aclose()
    model.hold_response.set()
    model.hold_response = None
    try:
        events = await asyncio.wait_for(collect(caller), 5)
    finally:
        await caller.close()

    assert events[-1] == CallerTranscript("Fresh.")
    (truncate,) = model.of("conversation.item.truncate")
    assert (truncate["item_id"], truncate["content_index"], truncate["audio_end_ms"]) == (
        "item_cut",
        0,
        100,
    )
    assert "conversation.item.delete" not in model.types()
