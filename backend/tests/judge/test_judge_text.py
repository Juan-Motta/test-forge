"""Text (chat) runs are judged as chat conversations: no call, audio or heard wording, reply
timings measured from the user message to the first text and to the full reply."""

from judge_support import (
    CRITERIA,
    MUST_ID,
    SHOULD_ID,
    SNAPSHOT,
    SUMMARY,
    TEXT_SNAPSHOT,
    TEXT_SUMMARY,
    TEXT_TRANSCRIPT,
    answer,
    verdict,
)

from voice_eval.judge.brief import render_brief
from voice_eval.judge.domain import parse_judgement, run_kind
from voice_eval.judge.gating import gate_criteria
from voice_eval.judge.prompt import (
    SYSTEM_PROMPT,
    TEXT_SYSTEM_PROMPT,
    build_messages,
    render_timing,
    render_transcript,
)
from voice_eval.judge.scoring import score

INVOKE_SUMMARY = {
    **TEXT_SUMMARY,
    "text_mode": "invoke",
    "turns": [
        {"index": 1, "kind": "reply", "request_ms": 0.0, "first_text_ms": 1500.0,
         "end_ms": 1500.0, "latency_ms": 1500.0, "tools": []},
    ],
    "latencies_ms": [1500.0],
}  # fmt: skip

VOICE_ONLY_WORDING = (
    "voice agent",
    "phone",
    "test call",
    "this call",
    "heard",
    "audio",
    "spoken",
    "caller",
)


def test_the_run_kind_comes_from_the_summary_or_the_snapshot():
    assert run_kind(TEXT_SNAPSHOT, {}) == "text"
    assert run_kind({}, TEXT_SUMMARY) == "text"
    assert run_kind(SNAPSHOT, SUMMARY) == "voice"
    assert run_kind({}, {}) == "voice"


def test_the_text_system_prompt_reviews_a_chat_without_voice_wording():
    lowered = TEXT_SYSTEM_PROMPT.lower()
    for word in VOICE_ONLY_WORDING:
        assert word not in lowered, word
    assert "chat" in lowered and "conversation" in lowered
    assert "[reply broke off" in lowered
    assert "never use the `voice` area" in lowered
    for band in range(1, 6):
        assert f"- {band}:" in TEXT_SYSTEM_PROMPT


def test_a_text_run_is_judged_with_the_text_system_prompt():
    system, user = build_messages(TEXT_SNAPSHOT, TEXT_TRANSCRIPT, TEXT_SUMMARY, None, "none")
    assert system == {"role": "system", "content": TEXT_SYSTEM_PROMPT}
    assert TEXT_SYSTEM_PROMPT != SYSTEM_PROMPT
    assert "USER: A table for two" in user["content"]
    assert "first text" in user["content"]
    assert "Simulated user: Ana" in user["content"]
    assert "Kind: text chat agent (mode: stream)" in user["content"]
    assert "Context of the conversation" in user["content"]
    assert "caller" not in user["content"].lower()


def test_text_turns_are_chat_turns_with_tools_and_a_broken_off_reply():
    text = render_transcript(TEXT_TRANSCRIPT, kind="text")
    lines = text.splitlines()
    assert (
        lines[0] == "C1 [00:00] USER: A table for two at 8, please. (simulated user's intent: ask)"
    )
    assert lines[1] == (
        "A1 [00:00] AGENT: Booked for 8 pm. (time to first text 800 ms) "
        "(tools used: check_availability, book_table)"
    )
    assert lines[3] == (
        "A2 [00:04] AGENT: [REPLY BROKE OFF: no end-of-reply from the agent] Let me check the"
    )
    lowered = text.lower()
    assert "heard" not in lowered and "audio" not in lowered and "caller" not in lowered


def test_stream_timing_measures_first_text_and_full_reply_from_the_user_message():
    text = render_timing(TEXT_SUMMARY, kind="text")
    assert "Mode: stream" in text
    assert "Reply time (user message sent → first text): median 800 ms" in text
    assert (
        "| ref | user message sent | first text | full reply | to first text | to full reply"
        in text
    )
    assert (
        "| T1 | 0 ms | 800 ms | 1500 ms | 800 ms | 1500 ms | check_availability, book_table |"
        in text
    )
    lowered = text.lower()
    assert "audio" not in lowered and "playback" not in lowered and "caller" not in lowered
    assert "User messages: 2; agent replies: 1" in text


def test_invoke_timing_says_the_first_text_is_the_full_reply():
    text = render_timing(INVOKE_SUMMARY, kind="text")
    assert "Mode: invoke" in text
    assert "first text arrives with the full reply" in text
    assert "| T1 | 0 ms | 1500 ms | 1500 ms | 1500 ms | 1500 ms | - |" in text


def test_text_reply_timings_make_timing_criteria_observable():
    assert gate_criteria(CRITERIA, has_traces=True, summary=TEXT_SUMMARY) == {}
    no_latency = {"turns": [{"index": 1, "kind": "reply", "first_text_ms": 700.0}]}
    assert gate_criteria(CRITERIA, has_traces=True, summary=no_latency) == {}
    assert gate_criteria(CRITERIA, has_traces=True, summary={"turns": [{"tools": []}]}) == {
        SHOULD_ID: "no_timing_data"
    }


def test_a_voice_suggestion_is_filed_under_other_for_a_text_run():
    raw = answer(
        verdict(MUST_ID, 5),
        suggestions=[{"title": "Slow down", "detail": "d", "area": "voice", "priority": "low",
                      "evidenceRefs": []}],
    )  # fmt: skip
    assert parse_judgement(raw, CRITERIA, kind="text").suggestions[0].area == "other"
    assert parse_judgement(raw, CRITERIA).suggestions[0].area == "voice"


def test_the_text_brief_names_a_text_agent_review_without_voice_steps():
    parsed = parse_judgement(answer(verdict(MUST_ID, 1), verdict(SHOULD_ID, 5)), CRITERIA)
    text = render_brief(
        parsed,
        score(parsed.criteria),
        scenario_name="Book a table",
        agent_name="Vivi Chat",
        run_id="run-1",
        thread_id="thread-1",
        trace_note=None,
        kind="text",
    )
    assert text.startswith("# Text agent review: Vivi Chat / Book a table\n")
    assert "voice" not in text.lower()
    assert "(prompt, tools or flow)" in text
    assert 'Re-run the scenario "Book a table" against agent "Vivi Chat".' in text
    assert "A<n>/C<n> are the agent's/user's n-th message in the conversation" in text
    assert "T<n> the n-th agent reply's timings" in text
