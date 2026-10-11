"""The Markdown brief stands alone: run identity, score, problems with evidence, fixes, checks."""

from judge_support import CRITERIA, MUST_ID, SHOULD_ID, TRACE_ID, answer, verdict

from voice_eval.judge.brief import render_brief
from voice_eval.judge.domain import parse_judgement
from voice_eval.judge.scoring import score


def brief(*verdicts, note=None, **overrides) -> str:
    parsed = parse_judgement(answer(*verdicts, **overrides), CRITERIA)
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
    text = brief(verdict(MUST_ID, "fail", 20), verdict(SHOULD_ID, "pass", 90))
    assert text.startswith("# Voice agent review: Vivi / Book a table\n")
    for expected in (
        "- Run id: run-1",
        "- Thread id (Langfuse session id): thread-1",
        "- Overall score: 46 / 100",
        "- Must criteria failed: YES",
        "The agent booked the table but answered slowly.",
    ):
        assert expected in text, expected


def test_lists_problems_with_rationale_and_evidence_quotes():
    text = brief(verdict(MUST_ID, "fail", 20), verdict(SHOULD_ID, "partial", 50))
    problems = text.split("## Problems found")[1].split("## Not observable")[0]
    assert problems.index("[FAIL] Confirms the booking") < problems.index("[PARTIAL] Replies")
    assert "- MUST criterion, source transcript, weight 50, score 20" in problems
    assert f"- Why: rationale for {MUST_ID[:4]}" in problems
    assert '- Evidence (transcript A2): "Booked for 8 pm."' in problems
    assert "Calls the booking tool once: The judge returned no verdict" in text


def test_suggestions_come_high_priority_first_with_their_evidence():
    text = brief(verdict(MUST_ID))
    changes = text.split("## Changes to make (highest priority first)")[1]
    assert changes.index("Confirm the time explicitly") < changes.index("Cache the availability")
    assert "1. **Confirm the time explicitly** (high priority, prompt)" in changes
    assert "   Evidence: A2" in changes


def test_strengths_passes_and_how_to_verify():
    text = brief(verdict(MUST_ID), verdict(SHOULD_ID), verdict(TRACE_ID))
    assert "No criterion failed or partially passed." in text
    assert "- Friendly greeting" in text
    assert "- Confirms the booking (score 90)" in text
    assert "## How to verify" in text
    assert 'Re-run the scenario "Book a table" against agent "Vivi"' in text
    assert "- Must criteria failed: no" in text


def test_no_observable_criterion_and_trace_note():
    text = brief(note="no traces arrived", suggestions=[], strengths=[])
    assert "- Overall score: n/a (no criterion was observable) / 100" in text
    assert "- Traces: no traces arrived" in text
    assert "No changes suggested." in text
    assert "## Keep" not in text


def test_is_deterministic():
    args = (verdict(MUST_ID, "fail", 20), verdict(SHOULD_ID, "partial", 50))
    assert brief(*args) == brief(*args)
