"""The text session runner: the policy-driven user chats with a fake text target.

The policy and the target are scripted fakes: no provider and no agent is ever contacted.
"""

import asyncio
import json
import uuid
from collections.abc import Callable

import pytest

from voice_eval.evaluator.prompt import ChatPolicyState
from voice_eval.ports.policy import CallerBrief, CallerDecision, PolicyState
from voice_eval.ports.text_target import (
    ReplyEnded,
    TextDelta,
    TextTargetError,
    ToolEnded,
    ToolStarted,
)
from voice_eval.runner.events import RunEvent
from voice_eval.runner.text_session import TextSessionOptions, TextSessionRunner

BRIEF = CallerBrief(
    agent_context="",
    scenario_context="",
    persona_name="Ana",
    locale="en-US",
    temperament="calm",
    persona_notes="",
    goal="Learn the balance.",
    instructions="",
    facts=(),
    hang_up_when="goal_or_goodbye",
    max_duration_s=30,
)
THREAD = str(uuid.uuid4())


class ScriptedPolicy:
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


class FakeTarget:
    """Answers each message with `reply(message)` (a list of events), after `delay_s`."""

    def __init__(self, reply: Callable[[str], list] | None = None, delay_s: float = 0) -> None:
        self.reply = reply or (lambda message: _text_reply(f"echo: {message}"))
        self.delay_s = delay_s
        self.sent: list[tuple[str, str]] = []
        self.closed = 0

    async def send(self, message: str, *, thread_id: str):
        self.sent.append((message, thread_id))
        try:
            if self.delay_s:
                await asyncio.sleep(self.delay_s)
            for event in self.reply(message):
                if isinstance(event, Exception):
                    raise event
                yield event
        finally:
            self.closed += 1


def _text_reply(text: str, first: int = 120, total: int = 300) -> list:
    half = len(text) // 2
    return [TextDelta(text[:half]), TextDelta(text[half:]), ReplyEnded(text, first, total)]


class Sink:
    def __init__(self) -> None:
        self.events: list[RunEvent] = []

    async def emit(self, event: RunEvent) -> None:
        self.events.append(event)

    def types(self) -> list[str]:
        return [event.type for event in self.events]


def runner(tmp_path, policy, target, **options) -> tuple[TextSessionRunner, Sink]:
    sink = Sink()
    notices = options.pop("notices", ())
    text_mode = options.pop("text_mode", "stream")
    return (
        TextSessionRunner(
            target=target,
            thread_id=THREAD,
            channel_id="channel-1",
            text_mode=text_mode,
            brief=BRIEF,
            policy=policy,
            sink=sink,
            out_dir=tmp_path,
            options=TextSessionOptions(**options),
            notices=notices,
        ),
        sink,
    )


async def test_a_chat_runs_until_the_user_hangs_up(tmp_path):
    policy = ScriptedPolicy(by_turn(say("Hi"), say("My balance?"), HANG_UP))
    target = FakeTarget()
    run, sink = runner(tmp_path, policy, target)

    summary = await run.run()

    assert (summary["status"], summary["reason"], summary["error"]) == (
        "completed",
        "caller_hung_up",
        None,
    )
    assert target.sent == [("Hi", THREAD), ("My balance?", THREAD)]  # one thread, every turn
    assert target.closed == 2
    assert summary["kind"] == "text"
    assert summary["text_mode"] == "stream"
    assert summary["thread_id"] == summary["langfuse_session_id"] == THREAD
    assert (summary["caller_turns"], summary["agent_turns"]) == (2, 2)
    assert summary["max_turns"] == 20
    assert len(summary["turns"]) == 2
    turn = summary["turns"][0]
    assert turn["index"] == 0 and turn["kind"] == "reply"
    assert turn["first_text_ms"] == turn["request_ms"] + 120
    assert turn["end_ms"] == turn["request_ms"] + 300
    assert turn["latency_ms"] == 120
    assert summary["latencies_ms"] == [120, 120]
    assert summary["warnings"] == []
    assert summary["event_counts"]["agent_text_delta"] == 4

    # the policy saw the whole chat, as a chat
    last = policy.states[-1]
    assert isinstance(last, ChatPolicyState)
    assert last.max_turns == 20
    assert [(u.role, u.text) for u in last.conversation] == [
        ("caller", "Hi"),
        ("agent", "echo: Hi"),
        ("caller", "My balance?"),
        ("agent", "echo: My balance?"),
    ]

    names = sorted(p.name for p in tmp_path.iterdir())
    assert names == ["events.jsonl", "summary.json", "transcript.json"]  # no audio
    transcript = json.loads((tmp_path / "transcript.json").read_text())
    assert [(row["role"], row["text"]) for row in transcript] == [
        ("caller", "Hi"),
        ("agent", "echo: Hi"),
        ("caller", "My balance?"),
        ("agent", "echo: My balance?"),
    ]
    agent = transcript[1]
    assert agent["latency_ms"] == 120 and agent["first_text_ms"] == 120
    assert agent["tools"] == []
    assert agent["start_ms"] == transcript[0]["start_ms"] + 120
    assert agent["end_ms"] == transcript[0]["start_ms"] + 300
    assert json.loads((tmp_path / "summary.json").read_text()) == summary

    types = sink.types()
    assert types[:2] == ["run_started", "protocol_detected"]
    assert types[-1] == "run_finished"
    assert "caller_speaking" in types and "agent_transcript" in types and "turn_ended" in types
    started = sink.events[0].data
    assert started["kind"] == "text" and started["max_turns"] == 20
    lines = (tmp_path / "events.jsonl").read_text().splitlines()
    assert [json.loads(line)["type"] for line in lines] == types


async def test_tools_are_published_and_recorded_on_the_agent_row(tmp_path):
    def reply(message: str) -> list:
        return [
            ToolStarted("lookup_balance"),
            ToolEnded("lookup_balance", True, 40),
            TextDelta("It is $10."),
            ReplyEnded("It is $10.", 200, 260),
        ]

    policy = ScriptedPolicy(by_turn(say("Balance?"), HANG_UP))
    run, sink = runner(tmp_path, policy, FakeTarget(reply))
    await run.run()

    events = {event.type: event.data for event in sink.events}
    assert events["agent_tool_started"] == {"turn": 0, "name": "lookup_balance"}
    assert events["agent_tool_ended"] == {
        "turn": 0,
        "name": "lookup_balance",
        "success": True,
        "elapsed_ms": 40,
    }
    assert events["agent_text_delta"] == {"turn": 0, "text": "It is $10."}
    transcript = json.loads((tmp_path / "transcript.json").read_text())
    assert transcript[1]["tools"] == ["lookup_balance"]


async def test_the_chat_ends_at_max_turns(tmp_path):
    policy = ScriptedPolicy(lambda state: say(f"message {state.caller_turns}"))
    target = FakeTarget()
    run, _ = runner(tmp_path, policy, target, max_turns=3)

    summary = await run.run()

    assert (summary["status"], summary["reason"]) == ("completed", "max_turns")
    assert summary["caller_turns"] == summary["agent_turns"] == 3
    assert len(target.sent) == 3


async def test_a_farewell_is_sent_and_answered_before_the_chat_ends(tmp_path):
    policy = ScriptedPolicy(by_turn(say("Thanks, bye", hang_up=True)))
    target = FakeTarget()
    run, _ = runner(tmp_path, policy, target)

    summary = await run.run()

    assert (summary["status"], summary["reason"]) == ("completed", "caller_hung_up")
    assert target.sent == [("Thanks, bye", THREAD)]
    assert summary["agent_turns"] == 1


async def test_a_failed_reply_fails_the_run_with_its_message(tmp_path):
    def reply(message: str) -> list:
        return [
            TextDelta("Partial"),
            TextTargetError("The agent's stream ended before the reply finished"),
        ]

    run, _ = runner(tmp_path, ScriptedPolicy(by_turn(say("Hi"), HANG_UP)), FakeTarget(reply))
    summary = await run.run()

    assert (summary["status"], summary["reason"]) == ("failed", "agent_error")
    assert summary["error"] == "The agent's stream ended before the reply finished"
    assert summary["agent_turns"] == 0
    transcript = json.loads((tmp_path / "transcript.json").read_text())
    assert transcript[-1]["role"] == "agent"
    assert transcript[-1]["text"] == "Partial"
    assert transcript[-1]["incomplete"] is True


async def test_max_duration_caps_the_chat(tmp_path):
    policy = ScriptedPolicy(lambda state: say("Hi"))
    run, _ = runner(tmp_path, policy, FakeTarget(delay_s=5), max_duration_s=0.2)

    summary = await run.run()

    assert (summary["status"], summary["reason"]) == ("completed", "max_duration")
    assert (tmp_path / "summary.json").is_file()


async def test_hang_ups_are_ignored_when_the_scenario_ends_only_at_max_duration(tmp_path):
    policy = ScriptedPolicy(by_turn(say("Hi"), say("bye", hang_up=True), say("still here")))
    target = FakeTarget()
    run, _ = runner(tmp_path, policy, target, max_turns=3, hang_up_when="max_duration")

    summary = await run.run()

    assert (summary["status"], summary["reason"]) == ("completed", "max_turns")
    assert [message for message, _ in target.sent] == ["Hi", "bye", "still here"]
    assert any("tried to end the chat" in warning for warning in summary["warnings"])


async def test_a_user_with_nothing_to_say_ends_the_chat(tmp_path):
    policy = ScriptedPolicy(by_turn(say("Hi"), HANG_UP))
    run, _ = runner(tmp_path, policy, FakeTarget(), hang_up_when="max_duration")

    summary = await run.run()

    assert (summary["status"], summary["reason"]) == ("completed", "caller_silent")
    assert len(policy.states) == 1 + 3  # the silent user is asked again, a bounded number of times


async def test_invoke_latency_is_the_full_reply(tmp_path):
    def reply(message: str) -> list:
        return [TextDelta("Done."), ReplyEnded("Done.", 900, 900)]

    run, _ = runner(
        tmp_path, ScriptedPolicy(by_turn(say("Hi"), HANG_UP)), FakeTarget(reply), text_mode="invoke"
    )
    summary = await run.run()

    assert summary["text_mode"] == "invoke"
    assert summary["latencies_ms"] == [900]


async def test_a_reply_without_text_is_warned_and_still_recorded(tmp_path):
    def reply(message: str) -> list:
        return [ReplyEnded("", None, 50)]

    run, _ = runner(tmp_path, ScriptedPolicy(by_turn(say("Hi"), HANG_UP)), FakeTarget(reply))
    summary = await run.run()

    assert summary["status"] == "completed"
    assert summary["latencies_ms"] == [50]
    assert "the agent reply had no text" in summary["warnings"]


async def test_notices_become_warnings(tmp_path):
    run, sink = runner(
        tmp_path,
        ScriptedPolicy(by_turn(HANG_UP)),
        FakeTarget(),
        notices=("interruptions are ignored in text runs",),
    )
    summary = await run.run()

    assert summary["warnings"] == ["interruptions are ignored in text runs"]
    assert summary["caller_turns"] == 0
    assert "warning" in sink.types()


async def test_an_evaluator_failure_fails_the_run(tmp_path):
    class Broken:
        async def next_turn(self, state):
            raise RuntimeError("boom")

    run, _ = runner(tmp_path, Broken(), FakeTarget())
    summary = await run.run()

    assert (summary["status"], summary["reason"]) == ("failed", "evaluator_failed")


async def test_cancelling_still_writes_the_artifacts(tmp_path):
    policy = ScriptedPolicy(lambda state: say("Hi"))
    run, _ = runner(tmp_path, policy, FakeTarget(delay_s=5))
    task = asyncio.create_task(run.run())
    await asyncio.sleep(0.1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    summary = json.loads((tmp_path / "summary.json").read_text())
    assert (summary["status"], summary["reason"]) == ("cancelled", "cancelled")


async def test_the_summary_records_the_evaluator_usage(tmp_path):
    from voice_eval.ports.usage import UsageMeter

    policy = ScriptedPolicy(by_turn(say("Hi"), HANG_UP))
    policy.usage = UsageMeter()
    policy.usage.add("gpt-6-luna", text_in=10, cached_text_in=5, text_out=3)
    run, _ = runner(tmp_path, policy, FakeTarget())
    summary = await run.run()
    assert summary["usage"] == {
        "by_model": {"gpt-6-luna": {"text_in": 10, "cached_text_in": 5, "text_out": 3}}
    }
