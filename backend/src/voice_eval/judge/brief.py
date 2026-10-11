"""A deterministic Markdown brief of a judgement, written to be pasted alone into a coding agent.

It names the run, states the score, lists what failed with the evidence, then the fixes to
make (high priority first) and how to check them. Nothing here calls a model.
"""

from voice_eval.judge.domain import CriterionResult, ParsedJudgement
from voice_eval.judge.scoring import Score

PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
VERDICT_LABEL = {
    "pass": "PASS",
    "partial": "PARTIAL",
    "fail": "FAIL",
    "not_observable": "NOT OBSERVABLE",
}


def _one_line(text: str) -> str:
    return " ".join(text.split())


def _criterion(result: CriterionResult) -> list[str]:
    score = "" if result.score is None else f", score {result.score}"
    lines = [
        f"### [{VERDICT_LABEL[result.verdict]}] {_one_line(result.text)}",
        f"- {result.kind.upper()} criterion, source {result.source}, weight {result.weight}{score}",
        f"- Why: {_one_line(result.rationale)}",
    ]
    for item in result.evidence:
        lines.append(f'- Evidence ({item.source} {item.ref}): "{_one_line(item.quote)}"')
    return lines


def render_brief(
    judgement: ParsedJudgement,
    numbers: Score,
    *,
    scenario_name: str,
    agent_name: str,
    run_id: str,
    thread_id: str | None,
    trace_note: str | None,
) -> str:
    overall = "n/a (no criterion was observable)" if numbers.overall is None else numbers.overall
    lines = [
        f"# Voice agent review: {agent_name} / {scenario_name}",
        "",
        f"- Agent: {agent_name}",
        f"- Scenario: {scenario_name}",
        f"- Run id: {run_id}",
        f"- Thread id (Langfuse session id): {thread_id or 'unknown'}",
        f"- Overall score: {overall} / 100",
        f"- Must criteria failed: {'YES' if numbers.must_failed else 'no'}",
    ]
    if trace_note:
        lines.append(f"- Traces: {_one_line(trace_note)}")
    lines += ["", "## Summary", "", _one_line(judgement.summary) or "(none)"]

    problems = [r for r in judgement.criteria if r.verdict in ("fail", "partial")]
    problems.sort(key=lambda r: (r.verdict != "fail", r.kind != "must", -r.weight))
    lines += ["", "## Problems found", ""]
    if problems:
        for result in problems:
            lines += [*_criterion(result), ""]
    else:
        lines += ["No criterion failed or partially passed.", ""]

    unobservable = [r for r in judgement.criteria if r.verdict == "not_observable"]
    if unobservable:
        lines += ["## Not observable", ""]
        for result in unobservable:
            lines.append(f"- {_one_line(result.text)}: {_one_line(result.rationale)}")
        lines.append("")

    suggestions = sorted(judgement.suggestions, key=lambda s: PRIORITY_ORDER[s.priority])
    lines += ["## Changes to make (highest priority first)", ""]
    if suggestions:
        for position, item in enumerate(suggestions, start=1):
            refs = ", ".join(item.evidence_refs) or "none"
            lines += [
                f"{position}. **{_one_line(item.title)}** ({item.priority} priority, {item.area})",
                f"   {_one_line(item.detail)}",
                f"   Evidence: {refs}",
            ]
    else:
        lines.append("No changes suggested.")

    if judgement.strengths:
        lines += ["", "## Keep (what worked)", ""]
        lines += [f"- {_one_line(text)}" for text in judgement.strengths]

    passed = [r for r in judgement.criteria if r.verdict == "pass"]
    if passed:
        lines += ["", "## Passed criteria", ""]
        lines += [f"- {_one_line(r.text)} (score {r.score})" for r in passed]

    lines += [
        "",
        "## How to verify",
        "",
        "1. Make the changes above in the agent (prompt, tools, flow or voice configuration).",
        f'2. Re-run the scenario "{scenario_name}" against agent "{agent_name}" in the voice'
        " evaluator.",
        "3. Compare the new judgement with this one: failed criteria should now pass, and no"
        " passed criterion should regress.",
        "",
        "Evidence refs: A<n>/C<n> are the agent's/caller's n-th turn in the transcript, T<n> the"
        " n-th agent turn's timings, R<n> the n-th Langfuse trace of the session.",
    ]
    return "\n".join(lines) + "\n"
