"""Usage capture of the evaluator's adapters: chat (policy and judge), TTS and realtime.

Every client is a fake: no model is contacted.
"""

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest
from test_openai_realtime_caller import (  # the realtime fake model and helpers
    AUDIO,
    FakeRealtimeModel,
    audio_events,
    collect,
    openai_caller,
)
from websockets.asyncio.server import serve

from voice_eval.judge.domain import JudgeError
from voice_eval.ports.policy import CallerBrief, PolicyState
from voice_eval.ports.usage import TTS_AUDIO_NOT_METERED, TTS_TEXT_ESTIMATED
from voice_eval.providers.openai_chat import OpenAIChatPolicy, OpenAIJudge
from voice_eval.providers.openai_realtime_caller import OpenAIRealtimeCaller, realtime_counts
from voice_eval.providers.openai_tts import OpenAISpeechSynthesizer

ANSWER = {"summary": "ok", "criteria": [], "suggestions": [], "strengths": []}
DECISION = {"say": "Hello", "hangUp": False, "reason": "opening"}
BRIEF = CallerBrief(
    agent_context="",
    scenario_context="",
    persona_name="Ana",
    locale="en-US",
    temperament="calm",
    persona_notes="",
    goal="Book a room.",
    instructions="",
    facts=(),
    hang_up_when="goal_or_goodbye",
    max_duration_s=30,
)


def completion(content: str, *, prompt: int, cached: int | None, out: int, reasoning: int = 0):
    details = None if cached is None else SimpleNamespace(cached_tokens=cached)
    usage = SimpleNamespace(
        prompt_tokens=prompt,
        completion_tokens=out,
        prompt_tokens_details=details,
        completion_tokens_details=SimpleNamespace(reasoning_tokens=reasoning),
    )
    message = SimpleNamespace(content=content, refusal=None)
    choice = SimpleNamespace(message=message, finish_reason="stop")
    return SimpleNamespace(choices=[choice], usage=usage)


def fake_client(*answers) -> SimpleNamespace:
    queue = list(answers)

    async def create(**kwargs):
        return queue.pop(0)

    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


# --- chat --------------------------------------------------------------------------------


async def test_the_judge_meters_every_answered_attempt_with_cached_tokens_apart():
    judge = OpenAIJudge(
        fake_client(
            completion("not json", prompt=1000, cached=200, out=300, reasoning=250),
            completion(json.dumps(ANSWER), prompt=1000, cached=None, out=100),
        ),
        "gpt-6-luna",
    )
    assert await judge.judge([{"role": "user", "content": "u"}]) == ANSWER
    # the malformed attempt was billed too; reasoning tokens are part of the output
    assert judge.usage.to_dict() == {
        "by_model": {"gpt-6-luna": {"text_in": 1800, "cached_text_in": 200, "text_out": 400}}
    }


async def test_a_judge_that_gives_up_keeps_what_it_used():
    bad = completion("[]", prompt=10, cached=0, out=5)
    judge = OpenAIJudge(fake_client(bad, bad), "gpt-6-luna")
    with pytest.raises(JudgeError):
        await judge.judge([{"role": "user", "content": "u"}])
    assert judge.usage.to_dict() == {"by_model": {"gpt-6-luna": {"text_in": 20, "text_out": 10}}}


async def test_an_azure_deployment_is_metered_as_its_base_model():
    policy = OpenAIChatPolicy(
        fake_client(completion(json.dumps(DECISION), prompt=50, cached=10, out=7)),
        "my-luna-deployment",
        usage_model="gpt-6-luna",
    )
    decision = await policy.next_turn(PolicyState(brief=BRIEF))
    assert decision.say == "Hello"
    assert policy.usage.to_dict() == {
        "by_model": {"gpt-6-luna": {"text_in": 40, "cached_text_in": 10, "text_out": 7}}
    }


async def test_an_answer_without_usage_meters_nothing():
    answer = completion(json.dumps(ANSWER), prompt=0, cached=None, out=0)
    answer.usage = None
    judge = OpenAIJudge(fake_client(answer), "gpt-6-luna")
    await judge.judge([{"role": "user", "content": "u"}])
    assert judge.usage.to_dict() is None


# --- TTS ---------------------------------------------------------------------------------


class FakeStreamedSpeech:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    async def iter_bytes(self, chunk_size: int | None = None):
        yield b"\x01\x00" * 10


async def test_tts_estimates_its_input_and_flags_the_audio_as_not_metered():
    synth = OpenAISpeechSynthesizer(
        SimpleNamespace(), "dep", "alloy", usage_model="gpt-4o-mini-tts"
    )
    synth.client.audio = SimpleNamespace(
        speech=SimpleNamespace(
            with_streaming_response=SimpleNamespace(create=lambda **kw: FakeStreamedSpeech())
        )
    )
    await synth.synthesize("Hello there")  # 11 characters: 3 tokens at 4 characters a token
    await synth.synthesize("Bye")
    assert synth.usage.to_dict() == {
        "by_model": {"gpt-4o-mini-tts": {"text_in": 4}},
        "notes": [TTS_AUDIO_NOT_METERED, TTS_TEXT_ESTIMATED],
    }


# --- realtime ----------------------------------------------------------------------------


def test_realtime_usage_splits_cached_tokens_out_of_text_and_audio():
    usage = {
        "input_tokens": 1500,
        "output_tokens": 400,
        "input_token_details": {
            "text_tokens": 500,
            "audio_tokens": 1000,
            "cached_tokens": 600,
            "cached_tokens_details": {"text_tokens": 200, "audio_tokens": 400},
        },
        "output_token_details": {"text_tokens": 100, "audio_tokens": 300},
    }
    assert realtime_counts(usage) == {
        "text_in": 300,
        "cached_text_in": 200,
        "audio_in": 600,
        "cached_audio_in": 400,
        "text_out": 100,
        "audio_out": 300,
    }


def test_realtime_usage_without_details_falls_back_to_totals_as_text():
    assert realtime_counts({"input_tokens": 90, "output_tokens": 40}) == {
        "text_in": 90,
        "cached_text_in": 0,
        "audio_in": 0,
        "cached_audio_in": 0,
        "text_out": 40,
        "audio_out": 0,
    }
    # a cached total without its split counts as cached text
    assert (
        realtime_counts({"input_tokens": 90, "input_token_details": {"cached_tokens": 30}})[
            "cached_text_in"
        ]
        == 30
    )
    assert realtime_counts("junk") == {}


USAGE = {
    "input_tokens": 120,
    "output_tokens": 60,
    "input_token_details": {"text_tokens": 20, "audio_tokens": 100, "cached_tokens": 0},
    "output_token_details": {"text_tokens": 10, "audio_tokens": 50},
}


@pytest.fixture
async def metered_model():
    fake = FakeRealtimeModel()
    original = fake._respond

    async def respond_with_usage(ws):
        sent = ws.send

        async def send(raw: str) -> None:
            event = json.loads(raw)
            if event["type"] == "response.done":
                event["response"]["usage"] = USAGE
            await sent(json.dumps(event))

        ws.send = send
        try:
            await original(ws)
        finally:
            ws.send = sent

    fake._respond = respond_with_usage
    async with serve(fake.handler, "127.0.0.1", 0, process_request=fake.process_request) as srv:
        fake.url = f"http://127.0.0.1:{srv.sockets[0].getsockname()[1]}"
        yield fake


async def test_the_realtime_caller_meters_every_finished_response_cancelled_ones_too(
    metered_model,
):
    metered_model.hold_response = asyncio.Event()
    metered_model.responses = [
        audio_events("", AUDIO, "stale words"),
        audio_events("", AUDIO, "Fresh."),
    ]
    caller: OpenAIRealtimeCaller = openai_caller(metered_model)
    await caller.open("You are Ana.")
    stream = caller.respond()
    await anext(stream)
    await stream.aclose()  # cancelled: its response.done still bills
    metered_model.hold_response.set()
    metered_model.hold_response = None
    try:
        await asyncio.wait_for(collect(caller), 5)
    finally:
        await caller.close()
    by_model: dict[str, Any] = caller.usage.to_dict()["by_model"]
    assert by_model == {
        "gpt-realtime-2.1-mini": {"text_in": 40, "audio_in": 200, "text_out": 20, "audio_out": 100}
    }


def test_an_azure_realtime_deployment_is_metered_as_its_model():
    caller = OpenAIRealtimeCaller.for_azure(
        "k",
        endpoint="https://r.example.com",
        deployment="rt-dep",
        voice="marin",
        usage_model="gpt-realtime-2.1",
    )
    assert caller.usage_model == "gpt-realtime-2.1"
    openai = OpenAIRealtimeCaller.for_openai("k", model="gpt-realtime-2.1-mini", voice="marin")
    assert openai.usage_model == "gpt-realtime-2.1-mini"
