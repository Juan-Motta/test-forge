"""The evaluator session runner end to end against the in-process Live and legacy fakes.

The policy and the TTS are scripted fakes: no provider is ever contacted.
"""

import json
from collections.abc import Callable

import pytest

from voice_eval.ports.policy import CallerBrief, CallerDecision, PolicyState
from voice_eval.ports.tts import SynthesisError
from voice_eval.runner.artifacts import ARTIFACT_NAMES
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
    facts=(),
    hang_up_when="goal_or_goodbye",
    max_duration_s=30,
)
SPEECH = b"\x10\x00" * 2400 * 3  # 300 ms


class ScriptedPolicy:
    """Decides with `script(state)`; keeps every state it was asked about."""

    def __init__(self, script: Callable[[PolicyState], CallerDecision]) -> None:
        self.script = script
        self.states: list[PolicyState] = []

    async def next_turn(self, state: PolicyState) -> CallerDecision:
        self.states.append(state)
        return self.script(state)


def by_turn(*decisions: CallerDecision) -> Callable[[PolicyState], CallerDecision]:
    return lambda state: decisions[min(state.caller_turns, len(decisions) - 1)]


def say(text: str, hang_up: bool = False) -> CallerDecision:
    return CallerDecision(text, hang_up, f"said {text}")


HANG_UP = CallerDecision(None, True, "goal met")


class FakeTts:
    def __init__(self, fail: bool = False) -> None:
        self.texts: list[str] = []
        self.fail = fail

    async def synthesize(self, text: str) -> bytes:
        self.texts.append(text)
        if self.fail:
            raise SynthesisError("no audio")
        return SPEECH


class ListSink:
    def __init__(self) -> None:
        self.events: list[RunEvent] = []

    async def emit(self, event: RunEvent) -> None:
        self.events.append(event)

    def of(self, kind: str) -> list[RunEvent]:
        return [e for e in self.events if e.type == kind]

    def types(self) -> list[str]:
        return [e.type for e in self.events]


def options(**overrides) -> SessionOptions:
    base = {
        "max_duration_s": 30,
        "max_silence_s": 8,
        "silence_gap_ms": 300,
        "settle_ms": 300,
        "playback_grace_ms": 50,
    }
    return SessionOptions(**{**base, **overrides})


async def run(url, tmp_path, policy, *, tts=None, opts=None):
    sink = ListSink()
    runner = SessionRunner(
        TargetSpec(url, "chan-test", "user-test"),
        brief=BRIEF,
        policy=policy,
        synthesizer=tts or FakeTts(),
        sink=sink,
        out_dir=tmp_path / "run",
        options=opts or options(),
    )
    summary = await runner.run()
    return summary, sink


def transcript(tmp_path) -> list[dict]:
    return json.loads((tmp_path / "run" / "transcript.json").read_text())


async def test_live_conversation_completes_in_order(fake_live_server, tmp_path):
    policy = ScriptedPolicy(by_turn(say("I need a room"), say("Two nights"), HANG_UP))
    tts = FakeTts()
    summary, sink = await run(fake_live_server.url, tmp_path, policy, tts=tts)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    assert summary["protocol"] == "live"
    assert (summary["caller_turns"], summary["agent_turns"]) == (2, 3)
    assert tts.texts == ["I need a room", "Two nights"]
    first, second, third = policy.states
    assert [(u.role, u.text) for u in first.conversation] == [
        ("agent", "hello I am the fake agent")
    ]
    assert [(u.role, u.text) for u in third.conversation] == [
        ("agent", "hello I am the fake agent"),
        ("caller", "I need a room"),
        ("agent", "agent reply number 1"),
        ("caller", "Two nights"),
        ("agent", "agent reply number 2"),
    ]
    assert (second.caller_turns, third.caller_turns) == (1, 2)
    assert third.elapsed_s > first.elapsed_s

    rows = transcript(tmp_path)
    assert [(r["role"], r["text"]) for r in rows] == [(u.role, u.text) for u in third.conversation]
    assert all(r["start_ms"] <= r["end_ms"] for r in rows)
    assert rows[2]["latency_ms"] > 0  # agent reply: caller end -> first agent audio

    types = sink.types()
    assert types[:2] == ["run_started", "protocol_detected"]
    assert types[-1] == "run_finished"
    assert sink.of("run_finished")[0].data == {"status": "completed", "reason": "caller_hung_up"}
    assert len(sink.of("agent_transcript")) == 3
    assert len(sink.of("turn_ended")) == 3
    assert [e.data["hang_up"] for e in sink.of("caller_decision")] == [False, False, True]
    assert all(e.pcm for e in sink.of("agent_audio") + sink.of("caller_audio"))
    times = [e.t_ms for e in sink.events]
    assert times == sorted(times)
    # each agent transcript is published once its turn has ended, before the next decision
    decided = [e.t_ms for e in sink.of("caller_decision")]
    heard = [e.t_ms for e in sink.of("agent_transcript")]
    assert all(h <= d for h, d in zip(heard, decided, strict=True))


async def test_artifacts_are_written_without_audio_payloads(fake_live_server, tmp_path):
    policy = ScriptedPolicy(by_turn(say("I need a room"), HANG_UP))
    summary, sink = await run(fake_live_server.url, tmp_path, policy)

    out = tmp_path / "run"
    for name in ARTIFACT_NAMES:
        assert (out / name).stat().st_size > 0, name
    events = [json.loads(line) for line in (out / "events.jsonl").read_text().splitlines()]
    assert [e["type"] for e in events] == sink.types()
    assert all("pcm" not in e and "delta" not in e and "audio" not in e for e in events)
    assert json.loads((out / "summary.json").read_text()) == summary
    assert summary["thread_id"] and summary["session_id"] == "sess-fake"
    assert summary["final_usage_confirmed"] is True
    assert (out / "caller.wav").stat().st_size > len(SPEECH)


async def test_legacy_caller_speaks_first(fake_realtime_server, tmp_path):
    policy = ScriptedPolicy(by_turn(say("Hello there"), say("One more thing"), HANG_UP))
    summary, sink = await run(fake_realtime_server.url, tmp_path, policy)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    assert summary["protocol"] == "realtime"
    assert policy.states[0].conversation == ()  # opening turn: nobody has spoken yet
    assert [(r["role"], r["text"]) for r in transcript(tmp_path)] == [
        ("caller", "Hello there"),
        ("agent", "agent response number 1"),
        ("caller", "One more thing"),
        ("agent", "agent response number 2"),
    ]
    assert fake_realtime_server.protocol_violations == []
    assert fake_realtime_server.client_close_codes == [1000]


async def test_hang_up_waits_for_the_agent_playback(fake_live_server, tmp_path):
    fake_live_server.burst_audio_ms = 1500  # the greeting arrives at once but plays for 1.5 s
    policy = ScriptedPolicy(by_turn(HANG_UP))
    summary, sink = await run(fake_live_server.url, tmp_path, policy)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    (turn,) = sink.of("turn_ended")
    (decision,) = sink.of("caller_decision")
    (finished,) = sink.of("run_finished")
    playback_end = turn.data["playback_end_ms"]
    assert decision.t_ms < playback_end  # decided while the greeting was still playing
    assert finished.t_ms >= playback_end  # but hung up only once it had played


async def test_a_farewell_is_spoken_before_hanging_up(fake_live_server, tmp_path):
    policy = ScriptedPolicy(by_turn(say("Bye, thanks", hang_up=True)))
    summary, _ = await run(fake_live_server.url, tmp_path, policy)

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    assert summary["caller_turns"] == 1
    assert transcript(tmp_path)[-1]["text"] == "Bye, thanks"
    assert fake_live_server.received_types[-1] == "voice.close"


async def test_max_duration_stops_the_run(fake_realtime_server, tmp_path):
    policy = ScriptedPolicy(lambda state: say(f"turn {state.caller_turns}"))
    summary, sink = await run(
        fake_realtime_server.url, tmp_path, policy, opts=options(max_duration_s=2.5)
    )

    assert (summary["status"], summary["reason"]) == ("completed", "max_duration")
    assert 2500 <= summary["duration_ms"] < 2500 + 3000
    assert sink.of("run_finished")[0].data["reason"] == "max_duration"


async def test_max_silence_stops_the_run(fake_live_server, tmp_path):
    fake_live_server.speech_frames_to_answer = 10_000  # the agent never answers the caller
    policy = ScriptedPolicy(by_turn(say("Hello?")))
    summary, sink = await run(
        fake_live_server.url, tmp_path, policy, opts=options(max_silence_s=1.0)
    )

    assert (summary["status"], summary["reason"]) == ("completed", "max_silence")
    (finished,) = sink.of("run_finished")
    last_speech = max(e.t_ms for e in sink.of("caller_audio"))
    assert finished.t_ms >= last_speech + 1000


async def test_max_duration_rule_never_lets_the_caller_hang_up(fake_live_server, tmp_path):
    brief_policy = ScriptedPolicy(by_turn(HANG_UP))
    sink = ListSink()
    runner = SessionRunner(
        TargetSpec(fake_live_server.url, "chan-test", "user-test"),
        brief=BRIEF,
        policy=brief_policy,
        synthesizer=FakeTts(),
        sink=sink,
        out_dir=tmp_path / "run",
        options=options(max_duration_s=2, hang_up_when="max_duration"),
    )
    summary = await runner.run()
    assert summary["reason"] == "max_duration"
    assert any("hang up" in e.data["message"] for e in sink.of("warning"))


async def test_tts_failure_fails_the_run_and_keeps_artifacts(fake_live_server, tmp_path):
    policy = ScriptedPolicy(by_turn(say("I need a room")))
    summary, sink = await run(fake_live_server.url, tmp_path, policy, tts=FakeTts(fail=True))

    assert (summary["status"], summary["reason"]) == ("failed", "tts_failed")
    assert any("no audio" in e.data["message"] for e in sink.of("warning"))
    assert (tmp_path / "run" / "summary.json").exists()
    assert fake_live_server.received_types[-1] == "voice.close"


async def test_policy_crash_fails_the_run(fake_live_server, tmp_path):
    def boom(state):
        raise RuntimeError("policy exploded")

    summary, _ = await run(fake_live_server.url, tmp_path, ScriptedPolicy(boom))
    assert (summary["status"], summary["reason"]) == ("failed", "evaluator_failed")


async def test_unreachable_target_fails_cleanly(tmp_path, unused_tcp_port):
    policy = ScriptedPolicy(by_turn(HANG_UP))
    summary, sink = await run(f"ws://127.0.0.1:{unused_tcp_port}", tmp_path, policy)

    assert (summary["status"], summary["reason"]) == ("failed", "connect_failed")
    assert sink.types() == ["run_started", "warning", "run_finished"]
    assert policy.states == []
    assert (tmp_path / "run" / "summary.json").exists()


async def test_a_failing_sink_does_not_break_the_run(fake_live_server, tmp_path):
    class BrokenSink:
        async def emit(self, event: RunEvent) -> None:
            raise RuntimeError("sink down")

    runner = SessionRunner(
        TargetSpec(fake_live_server.url, "chan-test", "user-test"),
        brief=BRIEF,
        policy=ScriptedPolicy(by_turn(HANG_UP)),
        synthesizer=FakeTts(),
        sink=BrokenSink(),
        out_dir=tmp_path / "run",
        options=options(),
    )
    summary = await runner.run()
    assert summary["status"] == "completed"


@pytest.fixture
def unused_tcp_port() -> int:
    import socket

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def test_cancelling_the_run_closes_the_session_and_keeps_artifacts(
    fake_live_server, tmp_path
):
    import asyncio

    speaking = asyncio.Event()

    class SpeakingSink(ListSink):
        async def emit(self, event: RunEvent) -> None:
            await super().emit(event)
            if event.type == "caller_audio":
                speaking.set()

    sink = SpeakingSink()
    runner = SessionRunner(
        TargetSpec(fake_live_server.url, "chan-test", "user-test"),
        brief=BRIEF,
        policy=ScriptedPolicy(lambda state: say("still here")),
        synthesizer=FakeTts(),
        sink=sink,
        out_dir=tmp_path / "run",
        options=options(),
    )
    task = asyncio.create_task(runner.run())
    await asyncio.wait_for(speaking.wait(), 10)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    summary = json.loads((tmp_path / "run" / "summary.json").read_text())
    assert (summary["status"], summary["reason"]) == ("cancelled", "cancelled")
    assert sink.types()[-1] == "run_finished"
    assert fake_live_server.received_types[-1] == "voice.close"


def test_agent_text_tracker_reports_only_new_assistant_text():
    from voice_eval.ports.target import TranscriptMessage
    from voice_eval.runner.session import AgentTextTracker

    tracker = AgentTextTracker()
    a0 = TranscriptMessage("a0", "assistant", "hello", 0, 0, 0)
    u1 = TranscriptMessage("u1", "user", "hi there", 0, 0, 1)
    assert tracker.take([a0, u1]) == "hello"
    assert tracker.take([a0, u1]) == ""
    a0.text = "hello I am the agent"  # cumulative caption grew
    a1 = TranscriptMessage("a1", "assistant", "how can I help?", 0, 0, 2)
    assert tracker.take([a0, u1, a1]) == "I am the agent how can I help?"
    a1.text = "rewritten"  # a correction replaces the text
    assert tracker.take([a0, a1]) == "rewritten"
