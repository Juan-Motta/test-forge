"""Overall score and must-failure are computed in code from the per-criterion verdicts."""

from voice_eval.judge.domain import CriterionResult
from voice_eval.judge.scoring import score


def result(verdict: str, value: int | None, weight: int, kind: str = "should") -> CriterionResult:
    return CriterionResult(
        criterion_id=f"{verdict}-{weight}",
        text="t",
        kind=kind,
        source="transcript",
        weight=weight,
        verdict=verdict,
        score=value,
        rationale="r",
    )


def test_weighted_mean_over_all_observable_criteria():
    numbers = score([result("pass", 100, 50), result("partial", 50, 30), result("fail", 0, 20)])
    assert numbers.overall == 65  # (100*50 + 50*30 + 0*20) / 100
    assert numbers.observable_weight == 100
    assert numbers.must_failed is False


def test_not_observable_criteria_are_renormalized_away():
    numbers = score(
        [result("pass", 90, 50), result("partial", 60, 30), result("not_observable", None, 20)]
    )
    assert numbers.overall == 79  # (90*50 + 60*30) / 80 = 78.75
    assert numbers.observable_weight == 80


def test_nothing_observable_has_no_overall_score():
    numbers = score([result("not_observable", None, 60), result("not_observable", None, 40)])
    assert numbers.overall is None
    assert numbers.observable_weight == 0
    assert numbers.must_failed is False


def test_a_failed_must_criterion_is_flagged_even_with_a_high_score():
    numbers = score([result("fail", 30, 10, kind="must"), result("pass", 100, 90)])
    assert numbers.must_failed is True
    assert numbers.overall == 93


def test_a_partial_must_criterion_is_not_a_must_failure():
    assert score([result("partial", 50, 100, kind="must")]).must_failed is False
