"""The model's answer is reconciled with the run's criteria: bands map to fixed scores and
verdicts, capping tags cap the band, tags are normalized and unobservable reasons are typed."""

import pytest
from judge_support import CRITERIA, MUST_ID, SHOULD_ID, TRACE_ID, answer, verdict

from voice_eval.judge.domain import (
    MISSING_VERDICT,
    JudgeError,
    parse_judgement,
    run_failure_tags,
)


def by_id(parsed):
    return {item.criterion_id: item for item in parsed.criteria}


def test_copies_the_criteria_from_the_snapshot_in_their_order():
    parsed = parse_judgement(
        answer(verdict(TRACE_ID), verdict(MUST_ID), verdict(SHOULD_ID, 3)), CRITERIA
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
    assert must.rationale == f"reasoning for {MUST_ID[:4]}"
    assert by_id(parsed)[SHOULD_ID].band == 3


@pytest.mark.parametrize(
    ("band", "score", "expected"),
    [(5, 100, "pass"), (4, 90, "pass"), (3, 70, "partial"), (2, 50, "fail"), (1, 25, "fail")],
)
def test_each_band_maps_to_a_fixed_score_and_verdict(band, score, expected):
    item = by_id(parse_judgement(answer(verdict(MUST_ID, band)), CRITERIA))[MUST_ID]
    assert (item.band, item.score, item.verdict) == (band, score, expected)
    assert item.unobservable_reason is None and item.capped is False


@pytest.mark.parametrize(("band", "expected"), [(9, 5), (0, 1), (-3, 1), (4.0, 4)])
def test_out_of_range_bands_are_clamped(band, expected):
    assert by_id(parse_judgement(answer(verdict(MUST_ID, band)), CRITERIA))[MUST_ID].band == (
        expected
    )


def test_unknown_ids_are_dropped_and_missing_ones_are_judge_omitted():
    parsed = parse_judgement(answer(verdict("not-a-criterion"), verdict(MUST_ID)), CRITERIA)
    results = by_id(parsed)
    assert set(results) == {MUST_ID, SHOULD_ID, TRACE_ID}
    for missing in (SHOULD_ID, TRACE_ID):
        item = results[missing]
        assert (item.verdict, item.score, item.band) == ("not_observable", None, None)
        assert item.unobservable_reason == "judge_omitted"
        assert item.rationale == MISSING_VERDICT


def test_a_criterion_the_judge_marks_unobservable_has_no_band_score_or_tags():
    item = by_id(
        parse_judgement(
            answer(verdict(MUST_ID, 2, observable=False, tags=("off_topic",))), CRITERIA
        )
    )[MUST_ID]
    assert (item.verdict, item.band, item.score, item.failure_tags) == (
        "not_observable",
        None,
        None,
        [],
    )
    assert item.unobservable_reason == "judge_marked_unobservable"
    assert item.rationale == f"reasoning for {MUST_ID[:4]}"


@pytest.mark.parametrize(
    "tag",
    [
        "fabricated_information",
        "wrong_information",
        "instruction_ignored",
        "unsafe_or_policy_violation",
    ],
)
def test_a_capping_tag_caps_the_band_at_two(tag):
    item = by_id(parse_judgement(answer(verdict(MUST_ID, 4, tags=(tag,))), CRITERIA))[MUST_ID]
    assert (item.band, item.score, item.verdict, item.capped) == (2, 50, "fail", True)
    assert item.failure_tags == [tag]


def test_a_band_already_at_or_below_the_cap_is_not_marked_capped():
    item = by_id(
        parse_judgement(answer(verdict(MUST_ID, 1, tags=("wrong_information",))), CRITERIA)
    )[MUST_ID]
    assert (item.band, item.capped) == (1, False)


def test_a_capping_tag_wins_over_band_five():
    item = by_id(
        parse_judgement(answer(verdict(MUST_ID, 5, tags=("fabricated_information",))), CRITERIA)
    )[MUST_ID]
    assert (item.band, item.capped, item.failure_tags) == (2, True, ["fabricated_information"])


def test_non_capping_tags_do_not_move_the_band():
    item = by_id(parse_judgement(answer(verdict(MUST_ID, 4, tags=("slow_response",))), CRITERIA))[
        MUST_ID
    ]
    assert (item.band, item.capped, item.failure_tags) == (4, False, ["slow_response"])


def test_band_five_carries_no_tags():
    item = by_id(parse_judgement(answer(verdict(MUST_ID, 5, tags=("off_topic",))), CRITERIA))[
        MUST_ID
    ]
    assert (item.band, item.failure_tags) == (5, [])


def test_tags_are_normalized_deduplicated_and_at_most_five():
    raw = (
        " Off_Topic ",
        "off_topic",
        "bogus",
        "slow_response",
        "incomplete_task",
        "unclear_or_unnatural_speech",
        "cut_off_or_incomplete_reply",
        "tool_or_trace_error",
    )
    item = by_id(parse_judgement(answer(verdict(MUST_ID, 3, tags=raw)), CRITERIA))[MUST_ID]
    assert item.failure_tags == [
        "off_topic",
        "slow_response",
        "incomplete_task",
        "unclear_or_unnatural_speech",
        "cut_off_or_incomplete_reply",
    ]


def test_capping_tags_survive_the_five_tag_limit():
    raw = (
        "off_topic",
        "slow_response",
        "incomplete_task",
        "unclear_or_unnatural_speech",
        "cut_off_or_incomplete_reply",
        "wrong_information",
    )
    item = by_id(parse_judgement(answer(verdict(MUST_ID, 4, tags=raw)), CRITERIA))[MUST_ID]
    assert item.failure_tags[0] == "wrong_information"
    assert len(item.failure_tags) == 5
    assert (item.band, item.capped) == (2, True)


def test_gated_criteria_ignore_the_model_and_keep_their_typed_reason():
    parsed = parse_judgement(
        answer(verdict(MUST_ID), verdict(SHOULD_ID), verdict(TRACE_ID)),
        CRITERIA,
        gated={TRACE_ID: "traces_unavailable", SHOULD_ID: "no_timing_data"},
    )
    results = by_id(parsed)
    trace, timing = results[TRACE_ID], results[SHOULD_ID]
    assert (trace.verdict, trace.score, trace.band) == ("not_observable", None, None)
    assert trace.unobservable_reason == "traces_unavailable"
    assert "traces" in trace.rationale.lower()
    assert trace.evidence == []
    assert timing.unobservable_reason == "no_timing_data"
    assert "timing" in timing.rationale.lower()
    assert results[MUST_ID].verdict == "pass"


def test_run_failure_tags_count_every_criterion():
    parsed = parse_judgement(
        answer(
            verdict(MUST_ID, 2, tags=("off_topic", "wrong_information")),
            verdict(SHOULD_ID, 3, tags=("off_topic",)),
            verdict(TRACE_ID, 2, observable=False, tags=("slow_response",)),
        ),
        CRITERIA,
    )
    counts = run_failure_tags(parsed.criteria)
    assert counts == {"off_topic": 2, "wrong_information": 1}
    assert list(counts) == ["off_topic", "wrong_information"]  # most frequent first


def test_the_first_verdict_for_a_criterion_wins():
    parsed = parse_judgement(answer(verdict(MUST_ID, 1), verdict(MUST_ID, 5)), CRITERIA)
    assert by_id(parsed)[MUST_ID].verdict == "fail"


def test_long_text_is_clipped():
    long = verdict(MUST_ID)
    long["reasoning"] = "x" * 10_000
    parsed = parse_judgement(answer(long), CRITERIA)
    assert len(by_id(parsed)[MUST_ID].rationale) == 4000


@pytest.mark.parametrize(
    "bad",
    [
        None,
        [],
        {"summary": "s"},
        answer(verdict(MUST_ID, "great")),
        answer({"criterionId": MUST_ID, "verdict": "pass", "score": 90}),  # the v1 shape
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
