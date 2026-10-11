"""Judge results and the lenient-but-safe parser of the model's structured answer.

The model's answer is validated against the schema shape, then reconciled with the run's
criteria: verdicts for unknown criterion ids are dropped, criteria without a verdict become
`not_observable`, scores are clamped to 0..100 and ignored for `not_observable`. Free text is
clipped so one verbose answer cannot bloat the stored result.
"""

import math
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, ValidationError
from pydantic.alias_generators import to_camel

Verdict = Literal["pass", "partial", "fail", "not_observable"]
Source = Literal["transcript", "trace", "timing"]
Area = Literal["prompt", "tools", "flow", "latency", "voice", "other"]
Priority = Literal["high", "medium", "low"]

MISSING_VERDICT = "The judge returned no verdict for this criterion."
MAX_TEXT = 4000  # summary, rationale, suggestion detail
MAX_SHORT_TEXT = 500  # titles, quotes, refs, strengths
MAX_EVIDENCE = 12  # per criterion
MAX_SUGGESTIONS = 20
MAX_STRENGTHS = 12


class JudgeError(Exception):
    """The run could not be judged; the message is safe to show and to log."""


class _Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


def _clip(text: str, limit: int) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


# --- the model's answer (JUDGE_SCHEMA) ------------------------------------------------------


class Evidence(_Model):
    source: Source
    ref: str
    quote: str


class RawCriterion(_Model):
    criterion_id: str
    verdict: Verdict
    score: float
    rationale: str
    evidence: list[Evidence]


class Suggestion(_Model):
    title: str
    detail: str
    area: Area
    priority: Priority
    evidence_refs: list[str]


class RawJudgement(_Model):
    summary: str
    criteria: list[RawCriterion]
    suggestions: list[Suggestion]
    strengths: list[str]


# --- the stored result ----------------------------------------------------------------------


class CriterionResult(_Model):
    criterion_id: str
    text: str
    kind: Literal["must", "should"]
    source: Source
    weight: int
    verdict: Verdict
    score: int | None  # None when not observable
    rationale: str
    evidence: list[Evidence] = Field(default_factory=list)


class JudgeResult(_Model):
    summary: str
    criteria: list[CriterionResult]
    overall_score: int | None  # weighted over observable criteria; None when none was
    must_failed: bool
    observable_weight: int
    suggestions: list[Suggestion]
    strengths: list[str]
    brief: str  # Markdown for a coding agent
    trace_stats: dict[str, Any] | None
    trace_note: str | None
    model: str


class ParsedJudgement(_Model):
    summary: str
    criteria: list[CriterionResult]
    suggestions: list[Suggestion]
    strengths: list[str]


def _clamp(score: float) -> int:
    return max(0, min(100, round(score)))


def _evidence(items: list[Evidence]) -> list[Evidence]:
    return [
        Evidence(
            source=item.source,
            ref=_clip(item.ref, MAX_SHORT_TEXT),
            quote=_clip(item.quote, MAX_SHORT_TEXT),
        )
        for item in items[:MAX_EVIDENCE]
    ]


def _integral(value: Any) -> Any:
    """A JSON number with no fractional part as an int (`10.0` -> 10); anything else is left
    to the strict int check, which refuses text, booleans and non-integral numbers."""
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    return value


class SnapshotCriterion(BaseModel):
    """A criterion as the run snapshot stores it (snake_case keys)."""

    id: str
    text: str
    kind: Literal["must", "should"]
    source: Source
    weight: Annotated[int, Field(strict=True), BeforeValidator(_integral)]


def _snapshot_criterion(criterion: Any) -> SnapshotCriterion:
    """Raises `JudgeError` (never echoing the snapshot) when the criterion is malformed."""
    try:
        if isinstance(criterion, dict) and criterion.get("id") is not None:
            criterion = {**criterion, "id": str(criterion["id"])}
        return SnapshotCriterion.model_validate(criterion)
    except ValidationError:
        raise JudgeError("malformed criterion in the run snapshot") from None


def parse_judgement(raw: Any, criteria: list[dict[str, Any]]) -> ParsedJudgement:
    """Reconcile the model's answer with the run's `criteria` (snapshot dicts).

    Raises `JudgeError` when the answer does not have the schema's shape, or a snapshot
    criterion is malformed (never echoing either).
    """
    snapshot = [_snapshot_criterion(criterion) for criterion in criteria]
    try:
        answer = RawJudgement.model_validate(raw)
    except ValidationError:
        raise JudgeError("malformed judge answer (does not match the judgement schema)") from None

    verdicts: dict[str, RawCriterion] = {}
    for item in answer.criteria:
        verdicts.setdefault(item.criterion_id.strip(), item)  # the first verdict wins

    results: list[CriterionResult] = []
    for criterion in snapshot:
        criterion_id = criterion.id
        common = {
            "criterion_id": criterion_id,
            "text": criterion.text,
            "kind": criterion.kind,
            "source": criterion.source,
            "weight": criterion.weight,
        }
        item = verdicts.get(criterion_id)
        if item is None:
            results.append(
                CriterionResult(
                    **common, verdict="not_observable", score=None, rationale=MISSING_VERDICT
                )
            )
            continue
        observable = item.verdict != "not_observable"
        results.append(
            CriterionResult(
                **common,
                verdict=item.verdict,
                score=_clamp(item.score) if observable else None,
                rationale=_clip(item.rationale, MAX_TEXT),
                evidence=_evidence(item.evidence),
            )
        )

    suggestions = [
        Suggestion(
            title=_clip(item.title, MAX_SHORT_TEXT),
            detail=_clip(item.detail, MAX_TEXT),
            area=item.area,
            priority=item.priority,
            evidence_refs=[_clip(ref, MAX_SHORT_TEXT) for ref in item.evidence_refs[:MAX_EVIDENCE]],
        )
        for item in answer.suggestions[:MAX_SUGGESTIONS]
    ]
    strengths = [_clip(text, MAX_SHORT_TEXT) for text in answer.strengths if text.strip()]
    return ParsedJudgement(
        summary=_clip(answer.summary, MAX_TEXT),
        criteria=results,
        suggestions=suggestions,
        strengths=strengths[:MAX_STRENGTHS],
    )
