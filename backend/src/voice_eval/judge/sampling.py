"""Aggregate several parsed judge samples of the same messages into one judgement.

The model is asked the same question several times (`service.JUDGE_SAMPLES`); a single answer
can land a band higher or lower on an ambiguous criterion, the median of a few does not.
Per criterion:

- criteria gated in code before the call keep their gated result (the same in every sample);
- when more than half of the samples have the criterion not observable, it stays not
  observable (with the first such sample's reason and rationale);
- otherwise its band is the lower median (`statistics.median_low`) of the observable samples'
  bands, and evidence, reasoning, failure tags and `capped` come from the first sample whose
  band equals it, so the stored explanation always matches the stored band.

Every criterion records `sample_bands`, one per sample (None where not observable). The run's
summary, suggestions and strengths come from the sample whose own overall score is the lower
median (ties: the first such sample).
"""

from statistics import median_low

from voice_eval.judge.domain import CriterionResult, ParsedJudgement
from voice_eval.judge.scoring import score

_GATED = ("traces_unavailable", "no_timing_data")


def _criterion(samples: list[CriterionResult]) -> CriterionResult:
    bands = [sample.band for sample in samples]
    first = samples[0]
    if first.unobservable_reason in _GATED:
        return first.model_copy(update={"sample_bands": bands})
    observed = [band for band in bands if band is not None]
    if len(samples) - len(observed) > len(samples) / 2:
        chosen = next(sample for sample in samples if sample.band is None)
    else:
        middle = median_low(observed)
        chosen = next(sample for sample in samples if sample.band == middle)
    return chosen.model_copy(update={"sample_bands": bands})


def _median_sample(samples: list[ParsedJudgement]) -> ParsedJudgement:
    overall = [score(sample.criteria).overall for sample in samples]
    scored = [value for value in overall if value is not None]
    if not scored:
        return samples[0]
    middle = median_low(scored)
    return samples[overall.index(middle)]


def aggregate(samples: list[ParsedJudgement]) -> ParsedJudgement:
    """One judgement from `samples` (at least one), all parsed against the same criteria, so
    their criteria lists are aligned."""
    criteria = [
        _criterion(list(group)) for group in zip(*(s.criteria for s in samples), strict=True)
    ]
    text = _median_sample(samples)
    return ParsedJudgement(
        summary=text.summary,
        criteria=criteria,
        suggestions=text.suggestions,
        strengths=text.strengths,
    )
