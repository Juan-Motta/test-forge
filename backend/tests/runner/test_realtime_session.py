"""The session runner with the realtime evaluator, against the in-process target fakes.

The realtime caller is an in-memory fake of the port: no model is ever contacted.
"""

import asyncio
import json
import time
from collections.abc import Callable
from typing import Any

from voice_eval.evaluator.prompt import REALTIME_JUST_INTERRUPTED, REALTIME_OPENING
from voice_eval.ports.policy import CallerBrief
from voice_eval.ports.realtime_caller import (
    CallerAudio,
    CallerTranscript,
    HangUp,
    RealtimeCallerError,
    ResponseEvent,
)
from voice_eval.runner.barge_in import Interruption, position_bytes
from voice_eval.runner.events import RunEvent
from voice_eval.runner.session import SessionOptions, SessionRunner
from voice_eval.targets.detect import TargetSpec

BRIEF = CallerBrief(
    agent_context="",
    scenario_context="",
    persona_name="Ana",
    locale="en-US",
    temperament="calm",
    persona_notes="",
    goal="Book a room.",
    instructions="",
    facts=(("Room", "412"),),
    hang_up_when="goal_or_goodbye",
    max_duration_s=30,
)
CHUNK = b"\x10\x00" * 2400  # 100 ms


def spoken(text: str, *, chunks: int = 3, hang_up: bool = False) -> list[ResponseEvent]:
    events: list[ResponseEvent] = [CallerAudio(CHUNK) for _ in range(chunks)]
    events.append(CallerTranscript(text))
    if hang_up:
        events.append(HangUp(f"call_{text}", "goal met"))
    return events


class FakeRealtimeCaller:
    """Plays `script[n]` for the n-th response; records what it heard and when."""

    def __init__(
        self,
        script: list[list[ResponseEvent]] | Callable[[int], list[ResponseEvent]],
        *,
        chunk_delay_s: float = 0,
        first_delay_s: float = 0,
        open_error: str | None = None,
        fail_on: int | None = None,
        delays: dict[int, float] | None = None,
    ) -> None:
        self.script = script
        self.chunk_delay_s = chunk_delay_s
        self.first_delay_s = first_delay_s
        self.open_error = open_error
        self.fail_on = fail_on
        self.delays = delays or {}  # first-audio delay per response, overriding first_delay_s
        self.cancelled: list[int] = []
        self.instructions: str | None = None
        self.heard = bytearray()
        self.appends: list[tuple[float, int]] = []  # (monotonic, bytes)
        self.responses: list[dict[str, Any]] = []
        self.tool_outputs: list[tuple[str, str]] = []
        self.closed = False

    async def open(self, instructions: str) -> None:
        if self.open_error:
            raise RealtimeCallerError(self.open_error)
        self.instructions = instructions

    async def append(self, pcm: bytes) -> None:
        self.heard += pcm
        self.appends.append((time.monotonic(), len(pcm)))

    async def respond(self, note: str | None = None):
        n = len(self.responses)
        record = {"note": note, "heard": len(self.heard), "at": time.monotonic(), "done": None}
        self.responses.append(record)
        if n == self.fail_on:
            raise RealtimeCallerError("the realtime model failed (server_error)")
        events = (
            self.script(n) if callable(self.script) else self.script[min(n, len(self.script) - 1)]
        )
        try:
            await asyncio.sleep(self.delays.get(n, self.first_delay_s))
            for i, event in enumerate(events):
                if i and isinstance(event, CallerAudio):
                    await asyncio.sleep(self.chunk_delay_s)
                yield event
        except (asyncio.CancelledError, GeneratorExit):
            self.cancelled.append(n)
            raise
        record["done"] = time.monotonic()

    async def tool_output(self, call_id: str, output: str) -> None:
        self.tool_outputs.append((call_id, output))

    async def close(self) -> None:
        self.closed = True


class ListSink:
    def __init__(self) -> None:
        self.events: list[RunEvent] = []

    async def emit(self, event: RunEvent) -> None:
        self.events.append(event)

    def of(self, kind: str) -> list[RunEvent]:
        return [e for e in self.events if e.type == kind]


def options(**overrides) -> SessionOptions:
    base = {
        "max_duration_s": 30,
        "max_silence_s": 8,
        "silence_gap_ms": 300,
        "settle_ms": 300,
        "playback_grace_ms": 50,
    }
    return SessionOptions(**{**base, **overrides})


async def run(url, tmp_path, caller, opts=None, brief=BRIEF, model="gpt-realtime-2.1-mini"):
    sink = ListSink()
    runner = SessionRunner(
        TargetSpec(url, "chan-test", "user-test"),
        brief=brief,
        policy=None,
        synthesizer=None,
        sink=sink,
        out_dir=tmp_path / "run",
        options=opts or options(),
        realtime=caller,
        realtime_model=model,
    )
    summary = await runner.run()
    return summary, sink


def transcript(tmp_path) -> list[dict]:
    return json.loads((tmp_path / "run" / "transcript.json").read_text())


async def test_the_realtime_caller_opens_hears_the_agent_and_hangs_up(
    fake_realtime_server, tmp_path
):
    fake = fake_realtime_server
    caller = FakeRealtimeCaller(
        [spoken("Hello, I need a room"), spoken("Two nights please"), spoken("Bye", hang_up=True)]
    )
    summary, sink = await run(fake.url, tmp_path, caller)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    assert fake.protocol_violations == []
    assert "Ana" in caller.instructions and "reveal only when asked" in caller.instructions
    # Opening turn: nobody spoke, the caller speaks first with nothing heard.
    first, second, third = caller.responses
    assert (first["note"], first["heard"]) == (REALTIME_OPENING, 0)
    assert second["note"] is None and second["heard"] > 0  # the agent's reply was appended
    assert third["heard"] > second["heard"]
    rows = transcript(tmp_path)
    assert [(r["role"], r["text"]) for r in rows] == [
        ("caller", "Hello, I need a room"),
        ("agent", "agent response number 1"),
        ("caller", "Two nights please"),
        ("agent", "agent response number 2"),
        ("caller", "Bye"),
    ]
    assert all(r["reason"] == "realtime" for r in rows if r["role"] == "caller")
    assert caller.tool_outputs == [("call_Bye", "the call has ended")]
    assert caller.closed
    decisions = sink.of("caller_decision")
    assert [d.data["say"] for d in decisions] == [
        "Hello, I need a room",
        "Two nights please",
        "Bye",
    ]
    assert [d.data["hang_up"] for d in decisions] == [False, False, True]
    assert [d.data["decision_id"] for d in decisions] == [1, 2, 3]
    speaking = sink.of("caller_speaking")
    assert [s.data["decision_id"] for s in speaking] == [1, 2, 3]
    assert all(s.data["tts_first_chunk_ms"] is not None for s in speaking)
    assert all(d.data["reason"] == "realtime" for d in decisions)
    assert summary["caller_turns"] == 3
    saved = json.loads((tmp_path / "run" / "summary.json").read_text())
    assert (saved["evaluator_mode"], saved["realtime_model"]) == (
        "realtime",
        "gpt-realtime-2.1-mini",
    )


async def test_the_caller_answers_only_after_the_agent_playback(fake_live_server, tmp_path):
    fake_live_server.burst_audio_ms = 1500  # the greeting arrives at once, plays for 1.5 s
    caller = FakeRealtimeCaller([spoken("Bye", hang_up=True)])
    summary, sink = await run(fake_live_server.url, tmp_path, caller)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    (turn,) = sink.of("turn_ended")
    (respond,) = caller.responses
    assert respond["note"] is None
    assert respond["heard"] == 1500 * 48  # the whole greeting was appended before
    started = sink.events[0]
    # response.create only once the greeting played (+ grace)
    elapsed_ms = (respond["at"] - caller.appends[0][0]) * 1000
    assert elapsed_ms >= 1500 - 100
    assert sink.of("caller_decision")[0].t_ms >= turn.data["playback_end_ms"]
    assert started.type == "run_started"


async def test_the_first_audio_reaches_the_agent_before_the_response_ends(
    fake_live_server, tmp_path
):
    caller = FakeRealtimeCaller(
        [spoken("I need a room", chunks=8), spoken("Bye", hang_up=True)], chunk_delay_s=0.1
    )
    summary, sink = await run(fake_live_server.url, tmp_path, caller)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    first = caller.responses[0]
    assert fake_live_server.caller_speech_started[0] < first["done"]
    # the caller's transcript row is the model's output transcript
    caller_rows = [r for r in transcript(tmp_path) if r["role"] == "caller"]
    assert [r["text"] for r in caller_rows] == ["I need a room", "Bye"]


async def test_hang_up_ends_the_call_after_the_goodbye_audio(fake_live_server, tmp_path):
    caller = FakeRealtimeCaller([spoken("Bye now", chunks=10, hang_up=True)])
    summary, sink = await run(fake_live_server.url, tmp_path, caller)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    frames = sink.of("caller_audio")
    assert len(frames) >= 10
    assert sink.of("run_finished")[0].t_ms >= frames[-1].t_ms
    row = transcript(tmp_path)[-1]
    assert (row["role"], row["text"]) == ("caller", "Bye now")
    assert row["end_ms"] is not None


async def test_the_max_duration_rule_refuses_the_hang_up(fake_live_server, tmp_path):
    caller = FakeRealtimeCaller(lambda n: spoken(f"turn {n}", hang_up=True))
    summary, sink = await run(
        fake_live_server.url,
        tmp_path,
        caller,
        opts=options(max_duration_s=3, hang_up_when="max_duration"),
    )
    assert summary["reason"] == "max_duration"
    assert any("hang up" in e.data["message"] for e in sink.of("warning"))
    assert caller.tool_outputs and all("cannot end" in out for _, out in caller.tool_outputs)


async def test_an_interrupted_turn_is_heard_only_up_to_the_cut(fake_realtime_server, tmp_path):
    fake = fake_realtime_server
    fake.burst_audio_ms, fake.items_per_response, fake.item_text = 1500, 2, "one two three"
    caller = FakeRealtimeCaller(
        [spoken("Hello there"), spoken("Sorry, one question"), spoken("Bye", hang_up=True)]
    )
    opts = options(interruptions=(Interruption(1, 1000),))
    summary, sink = await run(fake.url, tmp_path, caller, opts=opts)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    (cut,) = sink.of("caller_interrupted")
    second = caller.responses[1]
    assert second["note"] == REALTIME_JUST_INTERRUPTED
    # 3 s of agent audio arrived; the caller heard only what played before the cut
    played = position_bytes(cut.data["audio_end_ms"])
    assert abs(second["heard"] - played) <= 48 * 60
    assert second["heard"] < 1500 * 48
    third = caller.responses[2]
    assert third["note"] is None
    assert third["heard"] - second["heard"] == 1500 * 48 * 2  # the next reply, whole


async def test_a_realtime_failure_fails_the_run_safely(fake_live_server, tmp_path):
    caller = FakeRealtimeCaller([spoken("Hi")], fail_on=0)
    summary, sink = await run(fake_live_server.url, tmp_path, caller)

    assert (summary["status"], summary["reason"]) == ("failed", "realtime_failed")
    assert summary["error"] == "realtime caller failed (the realtime model failed (server_error))"
    assert (tmp_path / "run" / "summary.json").exists()
    assert fake_live_server.received_types[-1] == "voice.close"
    assert caller.closed


async def test_a_realtime_caller_that_cannot_open_fails_the_run(fake_live_server, tmp_path):
    caller = FakeRealtimeCaller(
        [], open_error="the realtime model refused the connection (HTTP 401)"
    )
    summary, _ = await run(fake_live_server.url, tmp_path, caller)
    assert (summary["status"], summary["reason"]) == ("failed", "realtime_failed")
    assert "HTTP 401" in summary["error"]


async def test_a_response_without_audio_or_hang_up_listens(fake_live_server, tmp_path):
    fake_live_server.speech_frames_to_answer = 10_000  # never answers
    caller = FakeRealtimeCaller([[CallerTranscript("")]])
    summary, _ = await run(fake_live_server.url, tmp_path, caller, opts=options(max_silence_s=1))
    assert summary["reason"] == "max_silence"
    assert summary["caller_turns"] == 0


async def test_the_response_is_cancelled_when_the_agent_speaks_first(
    fake_realtime_server, tmp_path
):
    fake = fake_realtime_server
    fake.follow_up_after = {1: 1.0}  # the agent adds something while the caller is thinking
    caller = FakeRealtimeCaller(
        [spoken("Hello"), spoken("stale"), spoken("Bye", hang_up=True)], delays={1: 2.0}
    )
    summary, sink = await run(fake.url, tmp_path, caller)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    assert caller.cancelled == [1]
    (discarded,) = sink.of("caller_decision_discarded")
    assert discarded.data["decision_id"] == 2
    caller_rows = [r["text"] for r in transcript(tmp_path) if r["role"] == "caller"]
    assert caller_rows == ["Hello", "Bye"]
    assert caller.responses[2]["heard"] > caller.responses[1]["heard"]  # it heard the follow-up


async def test_a_silent_hang_up_is_sent_back_for_a_spoken_goodbye(fake_live_server, tmp_path):
    from voice_eval.runner.session import HUNG_UP_OUTPUT, SAY_GOODBYE_OUTPUT

    caller = FakeRealtimeCaller(
        [spoken("Hello"), [HangUp("call_silent", "done")], spoken("Bye", hang_up=True)]
    )
    summary, sink = await run(fake_live_server.url, tmp_path, caller)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    assert caller.tool_outputs == [
        ("call_silent", SAY_GOODBYE_OUTPUT),
        ("call_Bye", HUNG_UP_OUTPUT),
    ]
    silent, goodbye = caller.responses[1], caller.responses[2]
    assert goodbye["heard"] == silent["heard"]  # asked again at once, no agent turn between
    assert goodbye["note"] is None
    caller_rows = [r["text"] for r in transcript(tmp_path) if r["role"] == "caller"]
    assert caller_rows == ["Hello", "Bye"]


async def test_a_second_silent_hang_up_ends_the_call(fake_live_server, tmp_path):
    from voice_eval.runner.session import HUNG_UP_OUTPUT, SAY_GOODBYE_OUTPUT

    caller = FakeRealtimeCaller(
        [spoken("Hello"), [HangUp("call_a", "done")], [HangUp("call_b", "done")]]
    )
    summary, _ = await run(fake_live_server.url, tmp_path, caller)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    assert caller.tool_outputs == [("call_a", SAY_GOODBYE_OUTPUT), ("call_b", HUNG_UP_OUTPUT)]
    assert len(caller.responses) == 3


async def test_the_asked_for_goodbye_ends_the_call_even_without_the_tool(
    fake_live_server, tmp_path
):
    from voice_eval.runner.session import SAY_GOODBYE_OUTPUT

    caller = FakeRealtimeCaller([spoken("Hello"), [HangUp("call_silent", "done")], spoken("Bye")])
    summary, _ = await run(fake_live_server.url, tmp_path, caller)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    assert caller.tool_outputs == [("call_silent", SAY_GOODBYE_OUTPUT)]
    assert len(caller.responses) == 3  # no further turn: goodbyes cannot ping-pong
    caller_rows = [r["text"] for r in transcript(tmp_path) if r["role"] == "caller"]
    assert caller_rows == ["Hello", "Bye"]
