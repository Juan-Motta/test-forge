"""The model's answer is reconciled with the run's criteria, and bad shapes are refused."""

import pytest
from judge_support import CRITERIA, MUST_ID, SHOULD_ID, TRACE_ID, answer, verdict

from voice_eval.judge.domain import MISSING_VERDICT, JudgeError, parse_judgement


def by_id(parsed):
    return {item.criterion_id: item for item in parsed.criteria}


def test_copies_the_criteria_from_the_snapshot_in_their_order():
    parsed = parse_judgement(
        answer(verdict(TRACE_ID), verdict(MUST_ID), verdict(SHOULD_ID, "partial", 55)), CRITERIA
    )
    assert [c.criterion_id for c in parsed.criteria] == [MUST_ID, SHOULD_ID, TRACE_ID]
    must = parsed.criteria[0]
    assert (must.text, must.kind, must.source, must.weight) == (
        "Confirms the booking",
        "must",
        "transcript",
        50,
    )
    assert must.evidence[0].quote == "Booked for 8 pm."
    assert by_id(parsed)[SHOULD_ID].score == 55


def test_unknown_ids_are_dropped_and_missing_ones_are_not_observable():
    parsed = parse_judgement(answer(verdict("not-a-criterion"), verdict(MUST_ID)), CRITERIA)
    results = by_id(parsed)
    assert set(results) == {MUST_ID, SHOULD_ID, TRACE_ID}
    for missing in (SHOULD_ID, TRACE_ID):
        assert results[missing].verdict == "not_observable"
        assert results[missing].score is None
        assert results[missing].rationale == MISSING_VERDICT


def test_scores_are_clamped_and_ignored_when_not_observable():
    parsed = parse_judgement(
        answer(
            verdict(MUST_ID, "pass", 140),
            verdict(SHOULD_ID, "fail", -5),
            verdict(TRACE_ID, "not_observable", 70),
        ),
        CRITERIA,
    )
    results = by_id(parsed)
    assert (results[MUST_ID].score, results[SHOULD_ID].score, results[TRACE_ID].score) == (
        100,
        0,
        None,
    )


def test_the_first_verdict_for_a_criterion_wins():
    parsed = parse_judgement(
        answer(verdict(MUST_ID, "fail", 10), verdict(MUST_ID, "pass", 100)), CRITERIA
    )
    assert by_id(parsed)[MUST_ID].verdict == "fail"


def test_long_text_is_clipped():
    long = verdict(MUST_ID)
    long["rationale"] = "x" * 10_000
    parsed = parse_judgement(answer(long), CRITERIA)
    assert len(by_id(parsed)[MUST_ID].rationale) == 4000


@pytest.mark.parametrize(
    "bad",
    [
        None,
        [],
        {"summary": "s"},
        answer(verdict(MUST_ID, "great")),
        answer(suggestions=[{"title": "t"}]),
    ],
)
def test_a_malformed_answer_raises_without_echoing_it(bad):
    with pytest.raises(JudgeError, match="malformed judge answer") as caught:
        parse_judgement(bad, CRITERIA)
    assert "great" not in str(caught.value)


@pytest.mark.parametrize(
    "broken",
    [
        {key: value for key, value in CRITERIA[0].items() if key != "text"},  # missing key
        {**CRITERIA[0], "weight": "heavy"},  # non-numeric weight
        {**CRITERIA[0], "weight": float("nan")},
        {**CRITERIA[0], "weight": float("inf")},
        {**CRITERIA[0], "weight": 12.5},  # not integral
        {**CRITERIA[0], "weight": "50"},  # a number as text is not a number
        {**CRITERIA[0], "weight": True},
        {**CRITERIA[0], "kind": "nice-to-have"},  # unknown kind
        {**CRITERIA[0], "source": "telepathy"},  # unknown source
        "not-a-criterion",
    ],
)
def test_a_malformed_snapshot_criterion_is_a_judge_error(broken):
    with pytest.raises(JudgeError, match="malformed criterion in the run snapshot") as caught:
        parse_judgement(answer(verdict(MUST_ID)), [broken, *CRITERIA[1:]])
    assert "heavy" not in str(caught.value) and "telepathy" not in str(caught.value)
    assert caught.value.__cause__ is None


@pytest.mark.parametrize("weight", [50, 50.0])
def test_an_integral_numeric_weight_is_accepted(weight):
    parsed = parse_judgement(answer(verdict(MUST_ID)), [{**CRITERIA[0], "weight": weight}])
    assert parsed.criteria[0].weight == 50
    assert type(parsed.criteria[0].weight) is int
