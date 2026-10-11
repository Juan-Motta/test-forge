"""Judge results and the lenient-but-safe parser of the model's structured answer.

The model's answer is validated against the schema shape, then reconciled with the run's
criteria. The model only picks an anchored band (1-5) per criterion; everything numeric is
decided here:

- the band maps to a fixed score (`BAND_SCORE`) and a verdict (4-5 pass, 3 partial, 1-2 fail);
- failure tags are normalized to the closed list (`FAILURE_TAGS`): trimmed, lowercased,
  unknown ones dropped, deduplicated, capping tags first, at most `MAX_TAGS`;
- a capping tag (`CAPPING_TAGS`) caps the band at `CAP_BAND` (worst case wins, nothing is
  averaged); a band 5 left uncapped carries no tags;
- a criterion is `not_observable` with a typed `UnobservableReason`: gated in code before the
  call (`traces_unavailable`, `no_timing_data`), marked so by the model
  (`judge_marked_unobservable`) or left without a verdict (`judge_omitted`).

Verdicts for unknown criterion ids are dropped. Free text is clipped so one verbose answer
cannot bloat the stored result.
"""

import math
from collections import Counter
from typing import Annotated, Any, Literal, get_args

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, ValidationError
from pydantic.alias_generators import to_camel

Verdict = Literal["pass", "partial", "fail", "not_observable"]
Source = Literal["transcript", "trace", "timing"]
Area = Literal["prompt", "tools", "flow", "latency", "voice", "other"]
Priority = Literal["high", "medium", "low"]
UnobservableReason = Literal[
    "traces_unavailable", "no_timing_data", "judge_marked_unobservable", "judge_omitted"
]
FailureTag = Literal[
    # capping: any of these caps the criterion at CAP_BAND
    "fabricated_information",
    "wrong_information",
    "instruction_ignored",
    "unsafe_or_policy_violation",
    # the rest describe the defect without capping
    "missing_information_request",
    "incomplete_task",
    "off_topic",
    "unclear_or_unnatural_speech",
    "cut_off_or_incomplete_reply",
    "slow_response",
    "tool_or_trace_error",
]

FAILURE_TAGS: tuple[str, ...] = get_args(FailureTag)
CAPPING_TAGS: tuple[str, ...] = FAILURE_TAGS[:4]
CAP_BAND = 2
MAX_TAGS = 5
BAND_SCORE = {5: 100, 4: 90, 3: 70, 2: 50, 1: 25}
RESULT_VERSION = 2

MISSING_VERDICT = "The judge returned no verdict for this criterion."
GATED_RATIONALE: dict[str, str] = {
    "traces_unavailable": "Not judged: the agent's traces were unavailable for this run.",
    "no_timing_data": "Not judged: the run has no usable turn timing data.",
}
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


def _integral(value: Any) -> Any:
    """A JSON number with no fractional part as an int (`10.0` -> 10); anything else is left
    to the strict int check, which refuses text, booleans and non-integral numbers."""
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    return value


# --- the model's answer (JUDGE_SCHEMA) ------------------------------------------------------


class Evidence(_Model):
    source: Source
    ref: str
    quote: str


class RawCriterion(_Model):
    criterion_id: str
    evidence: list[Evidence]
    reasoning: str
    observable: bool
    band: Annotated[int, BeforeValidator(_integral)]
    failure_tags: list[str]


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
    score: int | None  # BAND_SCORE of the band; None when not observable
    band: int | None = None  # 1-5 after the cap; None when not observable
    failure_tags: list[FailureTag] = Field(default_factory=list)
    unobservable_reason: UnobservableReason | None = None
    capped: bool = False  # a capping tag lowered the model's band
    rationale: str  # the model's reasoning, or why the criterion was not judged
    evidence: list[Evidence] = Field(default_factory=list)


class JudgeResult(_Model):
    version: int = RESULT_VERSION  # absent in results stored before judge v2
    summary: str
    criteria: list[CriterionResult]
    overall_score: int | None  # weighted over observable criteria; None when none was
    must_failed: bool
    observable_weight: int
    failure_tags: dict[str, int]  # tag -> number of criteria carrying it, most frequent first
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


def _band(value: int) -> int:
    return max(1, min(5, value))


def normalize_tags(raw: list[str]) -> list[str]:
    """Known tags only (trimmed, lowercased), deduplicated, capping tags first, at most
    `MAX_TAGS`, so a capping tag is never the one cut by the limit."""
    known: list[str] = []
    for item in raw:
        tag = item.strip().lower()
        if tag in FAILURE_TAGS and tag not in known:
            known.append(tag)
    capping = [tag for tag in known if tag in CAPPING_TAGS]
    return [*capping, *(tag for tag in known if tag not in CAPPING_TAGS)][:MAX_TAGS]


def verdict_for(band: int) -> Verdict:
    return "pass" if band >= 4 else "partial" if band == 3 else "fail"


def run_failure_tags(results: list["CriterionResult"]) -> dict[str, int]:
    """How many criteria carry each tag, most frequent first (ties in `FAILURE_TAGS` order)."""
    counts = Counter(tag for result in results for tag in result.failure_tags)
    return {
        tag: counts[tag]
        for tag in sorted(counts, key=lambda tag: (-counts[tag], FAILURE_TAGS.index(tag)))
    }


def _evidence(items: list[Evidence]) -> list[Evidence]:
    return [
        Evidence(
            source=item.source,
            ref=_clip(item.ref, MAX_SHORT_TEXT),
            quote=_clip(item.quote, MAX_SHORT_TEXT),
        )
        for item in items[:MAX_EVIDENCE]
    ]


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


def snapshot_criteria(criteria: list[Any]) -> list[SnapshotCriterion]:
    """The run snapshot's criteria, validated; raises `JudgeError` on a malformed one."""
    return [_snapshot_criterion(criterion) for criterion in criteria]


def _judged(common: dict[str, Any], item: RawCriterion) -> CriterionResult:
    rationale = _clip(item.reasoning, MAX_TEXT)
    evidence = _evidence(item.evidence)
    if not item.observable:
        return CriterionResult(
            **common,
            verdict="not_observable",
            score=None,
            unobservable_reason="judge_marked_unobservable",
            rationale=rationale,
            evidence=evidence,
        )
    asked = _band(item.band)
    tags = normalize_tags(item.failure_tags)
    capping = any(tag in CAPPING_TAGS for tag in tags)
    band = min(asked, CAP_BAND) if capping else asked
    if band == 5:
        tags = []  # a fully met criterion has no defect to tag
    return CriterionResult(
        **common,
        verdict=verdict_for(band),
        score=BAND_SCORE[band],
        band=band,
        failure_tags=tags,
        capped=band < asked,
        rationale=rationale,
        evidence=evidence,
    )


def parse_judgement(
    raw: Any,
    criteria: list[dict[str, Any]],
    *,
    gated: dict[str, UnobservableReason] | None = None,
) -> ParsedJudgement:
    """Reconcile the model's answer with the run's `criteria` (snapshot dicts).

    `gated` maps the ids of criteria decided before the call (see `gating`) to their reason;
    the model's answer for them, if any, is ignored.

    Raises `JudgeError` when the answer does not have the schema's shape, or a snapshot
    criterion is malformed (never echoing either).
    """
    snapshot = snapshot_criteria(criteria)
    gated = gated or {}
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
        if criterion_id in gated:
            reason = gated[criterion_id]
            results.append(
                CriterionResult(
                    **common,
                    verdict="not_observable",
                    score=None,
                    unobservable_reason=reason,
                    rationale=GATED_RATIONALE[reason],
                )
            )
            continue
        item = verdicts.get(criterion_id)
        if item is None:
            results.append(
                CriterionResult(
                    **common,
                    verdict="not_observable",
                    score=None,
                    unobservable_reason="judge_omitted",
                    rationale=MISSING_VERDICT,
                )
            )
            continue
        results.append(_judged(common, item))

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
