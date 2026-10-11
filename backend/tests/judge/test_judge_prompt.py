"""The judge prompt carries every piece of evidence, numbered so verdicts can cite it."""

from judge_support import MUST_ID, SHOULD_ID, SNAPSHOT, SUMMARY, TRACE_ID, TRANSCRIPT

from voice_eval.judge.prompt import SYSTEM_PROMPT, build_messages, render_transcript

DIGEST = {
    "stats": {"traceCount": 1, "observationCount": 2},
    "traces": [{"traceId": "t-1", "name": "turn", "observations": [{"name": "book_table"}]}],
}


def user_message(digest=None, note="the agent has no Langfuse connection") -> str:
    system, user = build_messages(SNAPSHOT, TRANSCRIPT, SUMMARY, digest, note)
    assert system == {"role": "system", "content": SYSTEM_PROMPT}
    assert user["role"] == "user"
    return user["content"]


def test_lists_every_criterion_with_its_id_kind_source_and_weight():
    text = user_message()
    assert f"id `{MUST_ID}` (must, source: transcript, weight 50): Confirms the booking" in text
    assert f"id `{SHOULD_ID}` (should, source: timing, weight 30)" in text
    assert f"id `{TRACE_ID}` (should, source: trace, weight 20)" in text


def test_numbers_the_turns_with_their_clock_time():
    text = user_message()
    assert "A1 [00:00] AGENT: Hello, Bella's, how can I help?" in text
    assert "C1 [00:03] CALLER: A table for two at 8, please." in text
    assert "A2 [01:06] AGENT: Booked for 8 pm. (latency 1300 ms)" in text


def test_includes_scenario_agent_and_timing():
    text = user_message()
    for expected in (
        "Goal: Book a table for two at 8 pm.",
        "Ana (en-US, hurried)",
        "Insist on 8 pm.",
        "- phone: 555-0100",
        "Restaurant receptionist.",
        "Status: completed (the caller hung up)",
        "median 1300 ms, max 1300 ms",
        "| T2 | reply, ended by done | 4800 ms | 6100 ms |",
        "- the agent turn had no transcript",
    ):
        assert expected in text, expected


def test_says_when_traces_are_unavailable():
    text = user_message()
    assert "Traces unavailable: the agent has no Langfuse connection." in text


def test_embeds_the_digest_with_numbered_trace_refs():
    text = user_message(DIGEST, note=None)
    assert '"ref":"R1","traceId":"t-1"' in text
    assert "book_table" in text
    assert "Traces unavailable" not in text


def test_long_transcripts_are_bounded():
    rows = [{"role": "caller", "text": "x" * 5000, "start_ms": 0}] * 450
    text = render_transcript(rows)
    assert "50 later turn(s) omitted" in text
    assert len(text) < 450 * 2100


def test_system_prompt_states_the_ground_rules():
    for expected in ("Never invent", "not_observable", "concrete changes", "evidence"):
        assert expected in SYSTEM_PROMPT
