"""The Markdown brief stands alone: run identity, score, problems with evidence, fixes, checks."""

from judge_support import CRITERIA, MUST_ID, SHOULD_ID, TRACE_ID, answer, verdict

from voice_eval.judge.brief import render_brief
from voice_eval.judge.domain import parse_judgement
from voice_eval.judge.scoring import score


def brief(*verdicts, note=None, gated=None, **overrides) -> str:
    parsed = parse_judgement(answer(*verdicts, **overrides), CRITERIA, gated=gated)
    return render_brief(
        parsed,
        score(parsed.criteria),
        scenario_name="Book a table",
        agent_name="Vivi",
        run_id="run-1",
        thread_id="thread-1",
        trace_note=note,
    )


def test_names_the_run_and_its_score():
    text = brief(verdict(MUST_ID, 1), verdict(SHOULD_ID, 5))
    assert text.startswith("# Voice agent review: Vivi / Book a table\n")
    for expected in (
        "- Run id: run-1",
        "- Thread id (Langfuse session id): thread-1",
        "- Overall score: 53 / 100",  # (25*50 + 100*30) / 80 = 53.1
        "- Must criteria failed: YES",
        "The agent booked the table but answered slowly.",
    ):
        assert expected in text, expected


def test_lists_problems_with_band_tags_reasoning_and_evidence_quotes():
    text = brief(
        verdict(MUST_ID, 4, tags=("fabricated_information", "slow_response")),
        verdict(SHOULD_ID, 3, tags=("slow_response",)),
    )
    problems = text.split("## Problems found")[1].split("## Not observable")[0]
    assert problems.index("[FAIL] Confirms the booking") < problems.index("[PARTIAL] Replies")
    assert (
        "- MUST criterion, source transcript, weight 50, band 2/5 "
        "(capped: fabricated information), score 50" in problems
    )
    assert "- Failure tags: fabricated_information, slow_response" in problems
    assert "- SHOULD criterion, source timing, weight 30, band 3/5, score 70" in problems
    assert f"- Why: reasoning for {MUST_ID[:4]}" in problems
    assert '- Evidence (transcript A2): "Booked for 8 pm."' in problems


def test_run_failure_tags_are_counted_in_the_header():
    text = brief(
        verdict(MUST_ID, 2, tags=("slow_response",)), verdict(SHOULD_ID, 3, tags=("slow_response",))
    )
    assert "- Failure tags: slow_response (2)" in text.split("## Summary")[0]


def test_not_observable_criteria_carry_a_typed_reason():
    text = brief(verdict(MUST_ID), verdict(SHOULD_ID, observable=False), gated=None)
    section = text.split("## Not observable")[1].split("## Changes")[0]
    assert "- Replies within 2 s [judge marked unobservable]:" in section
    assert "- Calls the booking tool once [judge omitted]: The judge returned no verdict" in section
    gated = brief(verdict(MUST_ID), gated={TRACE_ID: "traces_unavailable"})
    assert "- Calls the booking tool once [traces unavailable]:" in gated


def test_suggestions_come_high_priority_first_with_their_evidence():
    text = brief(verdict(MUST_ID))
    changes = text.split("## Changes to make (highest priority first)")[1]
    assert changes.index("Confirm the time explicitly") < changes.index("Cache the availability")
    assert "1. **Confirm the time explicitly** (high priority, prompt)" in changes
    assert "   Evidence: A2" in changes


def test_strengths_passes_and_how_to_verify():
    text = brief(verdict(MUST_ID), verdict(SHOULD_ID, 4), verdict(TRACE_ID))
    assert "No criterion failed or partially passed." in text
    assert "- Friendly greeting" in text
    assert "- Confirms the booking (band 5/5, score 100)" in text
    assert "- Replies within 2 s (band 4/5, score 90)" in text
    assert "## How to verify" in text
    assert 'Re-run the scenario "Book a table" against agent "Vivi"' in text
    assert "- Must criteria failed: no" in text
    assert "- Failure tags:" not in text


def test_no_observable_criterion_and_trace_note():
    text = brief(note="no traces arrived", suggestions=[], strengths=[])
    assert "- Overall score: n/a (no criterion was observable) / 100" in text
    assert "- Traces: no traces arrived" in text
    assert "No changes suggested." in text
    assert "## Keep" not in text


def test_is_deterministic():
    args = (verdict(MUST_ID, 1), verdict(SHOULD_ID, 3))
    assert brief(*args) == brief(*args)
