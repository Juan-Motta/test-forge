"""Judge one finished run: build the prompt, ask the model `JUDGE_SAMPLES` times, validate and
aggregate the samples (median band per criterion), score and write the brief."""

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from voice_eval.judge.brief import render_brief
from voice_eval.judge.domain import (
    JudgeError,
    JudgeResult,
    ParsedJudgement,
    RunKind,
    UnobservableReason,
    parse_judgement,
    run_failure_tags,
    run_kind,
)
from voice_eval.judge.gating import gate_criteria
from voice_eval.judge.prompt import build_messages
from voice_eval.judge.sampling import aggregate
from voice_eval.judge.scoring import score
from voice_eval.ports.judge import RunJudgeModel

if TYPE_CHECKING:
    from voice_eval.providers.langfuse_traces import TraceDigest

log = logging.getLogger(__name__)

JUDGE_SAMPLES = 3  # model calls per judgement, on identical messages
MIN_SAMPLES = 2  # successful samples needed to aggregate


async def _sample(
    model: RunJudgeModel,
    messages: list[dict[str, Any]],
    criteria: list[dict[str, Any]],
    gated: dict[str, UnobservableReason],
    kind: RunKind,
) -> ParsedJudgement:
    return parse_judgement(await model.judge(messages), criteria, gated=gated, kind=kind)


async def _samples(
    model: RunJudgeModel,
    messages: list[dict[str, Any]],
    criteria: list[dict[str, Any]],
    gated: dict[str, UnobservableReason],
    kind: RunKind,
) -> list[ParsedJudgement]:
    """The successful samples, asked concurrently. A sample that fails with `JudgeError` is
    logged (its type only, never its text) and skipped; fewer than `MIN_SAMPLES` successes
    raise the first such error. Any other exception propagates."""
    outcomes = await asyncio.gather(
        *(_sample(model, messages, criteria, gated, kind) for _ in range(JUDGE_SAMPLES)),
        return_exceptions=True,
    )
    parsed: list[ParsedJudgement] = []
    errors: list[JudgeError] = []
    for number, outcome in enumerate(outcomes, start=1):
        if isinstance(outcome, ParsedJudgement):
            parsed.append(outcome)
        elif isinstance(outcome, JudgeError):
            log.warning(
                "judge sample %d of %d failed (%s)", number, JUDGE_SAMPLES, type(outcome).__name__
            )
            errors.append(outcome)
        else:
            raise outcome
    if len(parsed) < MIN_SAMPLES:
        raise errors[0] if errors else JudgeError("too few judge samples")
    return parsed


async def judge_run(
    model: RunJudgeModel,
    *,
    snapshot: dict[str, Any],
    transcript: list[dict[str, Any]],
    summary: dict[str, Any],
    trace_digest: "TraceDigest | None",
    trace_note: str | None,
    run_id: str,
    thread_id: str | None,
    model_name: str,
) -> JudgeResult:
    """The run's judgement. `trace_note` says why traces are missing or partial, if they are.

    The model is asked `JUDGE_SAMPLES` times on identical messages and the samples are
    aggregated (`sampling.aggregate`); the numbers are then scored from the aggregate.

    Criteria whose evidence source is missing (no trace digest, no turn timings) are decided in
    code before the call: not sent as judgeable, stored as `not_observable` with their reason.

    A text (chat) run (`run_kind` of the snapshot and summary) is judged with the text prompt
    and gets the text brief.

    Raises `JudgeError` when fewer than `MIN_SAMPLES` samples succeed (the model failed or
    answered out of shape, after its own retries).
    """
    kind = run_kind(snapshot, summary)
    scenario = snapshot.get("scenario") or {}
    criteria = scenario.get("criteria") or []
    if not criteria:
        raise JudgeError("the run's scenario has no criteria to judge")
    prompt_digest = trace_digest.to_prompt_dict() if trace_digest is not None else None
    gated = gate_criteria(criteria, has_traces=prompt_digest is not None, summary=summary)
    messages = build_messages(snapshot, transcript, summary, prompt_digest, trace_note)
    samples = await _samples(model, messages, criteria, gated, kind)
    judgement = aggregate(samples)
    numbers = score(judgement.criteria)
    brief = render_brief(
        judgement,
        numbers,
        scenario_name=str(scenario.get("name") or "unnamed scenario"),
        agent_name=str((snapshot.get("agent") or {}).get("name") or "unnamed agent"),
        run_id=run_id,
        thread_id=thread_id,
        trace_note=trace_note,
        kind=kind,
    )
    return JudgeResult(
        summary=judgement.summary,
        criteria=judgement.criteria,
        overall_score=numbers.overall,
        must_failed=numbers.must_failed,
        observable_weight=numbers.observable_weight,
        failure_tags=run_failure_tags(judgement.criteria),
        suggestions=judgement.suggestions,
        strengths=judgement.strengths,
        brief=brief,
        trace_stats=prompt_digest["stats"] if prompt_digest is not None else None,
        trace_note=trace_note,
        model=model_name,
        samples=len(samples),
    )
