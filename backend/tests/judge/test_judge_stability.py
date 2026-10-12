"""The stability summary of repeated judgements of one run: spreads, flips and the table."""

from typing import Any

from voice_eval.judge.domain import BAND_SCORE, CriterionResult, JudgeResult
from voice_eval.judge.stability import render_stability, summarize_stability

MUST = "11111111-1111-4111-8111-111111111111"
SHOULD = "22222222-2222-4222-8222-222222222222"
TRACE = "33333333-3333-4333-8333-333333333333"
VERDICT = {5: "pass", 4: "pass", 3: "partial", 2: "fail", 1: "fail"}


def criterion(criterion_id: str, band: int | None, kind: str = "should") -> CriterionResult:
    return CriterionResult(
        criterion_id=criterion_id,
        text=f"criterion {criterion_id[:4]}",
        kind=kind,
        source="transcript",
        weight=10,
        verdict=VERDICT[band] if band is not None else "not_observable",
        score=BAND_SCORE[band] if band is not None else None,
        band=band,
        unobservable_reason=None if band is not None else "traces_unavailable",
        rationale="because",
    )


def result(bands: dict[str, int | None], overall: int | None) -> JudgeResult:
    kinds: dict[str, Any] = {MUST: "must"}
    return JudgeResult(
        summary="s",
        criteria=[criterion(cid, band, kinds.get(cid, "should")) for cid, band in bands.items()],
        overall_score=overall,
        must_failed=False,
        observable_weight=30,
        failure_tags={},
        suggestions=[],
        strengths=[],
        brief="# brief",
        trace_stats=None,
        trace_note=None,
        model="gpt-6-luna",
    )


SAMPLES = [
    result({MUST: 4, SHOULD: 2, TRACE: None}, 75),
    result({MUST: 4, SHOULD: 4, TRACE: None}, 90),
    result({MUST: 3, SHOULD: 2, TRACE: None}, 60),
]


def test_per_criterion_bands_spread_and_flips():
    report = summarize_stability(SAMPLES)

    assert report.samples == 3
    must, should, trace = report.criteria
    assert (must.criterion_id, must.kind) == (MUST, "must")
    assert must.bands == [4, 4, 3]
    assert must.verdicts == ["pass", "pass", "partial"]
    assert (must.min_band, must.max_band, must.spread, must.flips) == (3, 4, 1, 1)
    assert should.bands == [2, 4, 2]
    assert (should.spread, should.flips) == (2, 2)  # fail -> pass -> fail
    assert trace.bands == [None, None, None]
    assert (trace.min_band, trace.max_band, trace.spread, trace.flips) == (None, None, None, 0)


def test_overall_scores_and_unstable_count():
    report = summarize_stability(SAMPLES)

    assert report.overall_scores == [75, 90, 60]
    assert report.overall_spread == 30
    assert report.overall_mean == 75.0
    assert report.unstable_criteria == 1  # only SHOULD moved by two bands or more


def test_unobservable_in_some_samples_counts_band_spread_over_the_judged_ones():
    report = summarize_stability(
        [result({MUST: 5}, 100), result({MUST: None}, None), result({MUST: 5}, 100)]
    )

    (must,) = report.criteria
    assert must.bands == [5, None, 5]
    assert must.verdicts == ["pass", "not_observable", "pass"]
    assert (must.spread, must.flips) == (0, 2)
    assert report.overall_scores == [100, None, 100]
    assert (report.overall_spread, report.overall_mean) == (0, 100.0)
    assert report.unstable_criteria == 0


def test_no_overall_score_at_all():
    report = summarize_stability([result({MUST: None}, None), result({MUST: None}, None)])

    assert (report.overall_spread, report.overall_mean) == (None, None)


def test_a_criterion_missing_from_a_later_sample_is_reported_without_a_band():
    report = summarize_stability([result({MUST: 4, SHOULD: 3}, 80), result({MUST: 4}, 90)])

    should = report.criteria[1]
    assert should.bands == [3, None]
    assert should.verdicts == ["partial", "missing"]


def test_report_serializes_to_plain_json_types():
    data = summarize_stability(SAMPLES).to_dict()

    assert data["samples"] == 3
    assert data["unstableCriteria"] == 1
    assert data["overall"] == {"scores": [75, 90, 60], "spread": 30, "mean": 75.0}
    assert data["criteria"][1]["bands"] == [2, 4, 2]
    assert data["criteria"][1]["spread"] == 2


def test_table_lists_every_criterion_and_the_overall_line():
    text = render_stability(summarize_stability(SAMPLES))

    lines = text.splitlines()
    assert any("criterion 1111" in line and "4 4 3" in line for line in lines)
    assert any("criterion 2222" in line and "2 4 2" in line and "fail pass fail" in line
               for line in lines)  # fmt: skip
    assert any("criterion 3333" in line and "- - -" in line for line in lines)
    assert "overall: 75 90 60 (spread 30, mean 75.0)" in text
    assert "criteria with band spread >= 2: 1 of 3" in text


def test_unstable_criteria_show_why_each_sample_moved():
    samples = [result({MUST: 2, SHOULD: 5}, 50), result({MUST: 5, SHOULD: 5}, 100)]
    capped = (
        samples[0]
        .criteria[0]
        .model_copy(
            update={
                "capped": True,
                "failure_tags": ["fabricated_information"],
                "rationale": "Invented a reason.",
            }
        )
    )
    samples[0] = samples[0].model_copy(update={"criteria": [capped, samples[0].criteria[1]]})

    report = summarize_stability(samples)
    text = render_stability(report)

    must = report.criteria[0]
    assert must.details[0] == {
        "band": 2,
        "capped": True,
        "failureTags": ["fabricated_information"],
        "rationale": "Invented a reason.",
    }
    assert "why criterion 1111 moved:" in text
    assert "#1 band 2 capped (fabricated_information): Invented a reason." in text
    assert "#2 band 5 (no tags): because" in text
    assert "why criterion 2222" not in text  # stable criteria are not explained
