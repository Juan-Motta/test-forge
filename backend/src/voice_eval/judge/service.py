"""Judge one finished run: build the prompt, ask the model, validate, score and write the brief."""

from typing import TYPE_CHECKING, Any

from voice_eval.judge.brief import render_brief
from voice_eval.judge.domain import JudgeError, JudgeResult, parse_judgement, run_failure_tags
from voice_eval.judge.gating import gate_criteria
from voice_eval.judge.prompt import build_messages
from voice_eval.judge.scoring import score
from voice_eval.ports.judge import RunJudgeModel

if TYPE_CHECKING:
    from voice_eval.providers.langfuse_traces import TraceDigest


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

    Criteria whose evidence source is missing (no trace digest, no turn timings) are decided in
    code before the call: not sent as judgeable, stored as `not_observable` with their reason.

    Raises `JudgeError` when the model fails or answers out of shape (after its own retries).
    """
    scenario = snapshot.get("scenario") or {}
    criteria = scenario.get("criteria") or []
    if not criteria:
        raise JudgeError("the run's scenario has no criteria to judge")
    prompt_digest = trace_digest.to_prompt_dict() if trace_digest is not None else None
    gated = gate_criteria(criteria, has_traces=prompt_digest is not None, summary=summary)
    messages = build_messages(snapshot, transcript, summary, prompt_digest, trace_note)
    raw = await model.judge(messages)
    judgement = parse_judgement(raw, criteria, gated=gated)
    numbers = score(judgement.criteria)
    brief = render_brief(
        judgement,
        numbers,
        scenario_name=str(scenario.get("name") or "unnamed scenario"),
        agent_name=str((snapshot.get("agent") or {}).get("name") or "unnamed agent"),
        run_id=run_id,
        thread_id=thread_id,
        trace_note=trace_note,
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
    )
