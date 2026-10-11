"""The judgement's numbers, computed in code rather than trusted from the model."""

from dataclasses import dataclass

from voice_eval.judge.domain import CriterionResult


@dataclass(frozen=True)
class Score:
    overall: int | None  # None when no criterion was observable
    must_failed: bool
    observable_weight: int


def score(results: list[CriterionResult]) -> Score:
    """Weighted mean of the observable criteria, renormalized by their total weight.

    `not_observable` criteria neither help nor hurt; any `must` criterion that failed sets
    `must_failed` regardless of the overall number.
    """
    observable = [r for r in results if r.verdict != "not_observable" and r.score is not None]
    weight = sum(r.weight for r in observable)
    overall = round(sum(r.score * r.weight for r in observable) / weight) if weight else None
    must_failed = any(r.kind == "must" and r.verdict == "fail" for r in results)
    return Score(overall=overall, must_failed=must_failed, observable_weight=weight)
