"""Pure prompt builder and strict output schema of the run judge.

The system prompt holds the reviewer's rules; the user message holds the evidence of one run:
the scenario (goal, persona, instructions, facts, criteria), the agent's context, the numbered
transcript, the turn timings and the agent's Langfuse trace digest (or why it is missing).
Every section is bounded so a long call cannot blow the context window.
"""

import json
from typing import Any

MAX_TRANSCRIPT_ROWS = 400
MAX_ROW_CHARS = 2000
MAX_TIMING_ROWS = 200
MAX_WARNINGS = 30
MAX_CONTEXT_CHARS = 6000

_SOURCES = ["transcript", "trace", "timing"]


def _object(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def _string(description: str) -> dict[str, Any]:
    return {"type": "string", "description": description}


JUDGE_SCHEMA: dict[str, Any] = {
    "name": "run_judgement",
    "strict": True,
    "schema": _object(
        {
            "summary": _string("Two to four sentences on how the agent did in this call."),
            "criteria": {
                "type": "array",
                "items": _object(
                    {
                        "criterionId": _string("The criterion id, exactly as given."),
                        "verdict": {
                            "type": "string",
                            "enum": ["pass", "partial", "fail", "not_observable"],
                        },
                        "score": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 100,
                            "description": "0-100; ignored when not_observable.",
                        },
                        "rationale": _string("Why, grounded in the cited evidence."),
                        "evidence": {
                            "type": "array",
                            "items": _object(
                                {
                                    "source": {"type": "string", "enum": _SOURCES},
                                    "ref": _string("A1/C1 turn, T1 timing row or R1 trace ref."),
                                    "quote": _string("The exact words or values relied on."),
                                }
                            ),
                        },
                    }
                ),
            },
            "suggestions": {
                "type": "array",
                "items": _object(
                    {
                        "title": _string("A short imperative title."),
                        "detail": _string("The concrete change to make, and why."),
                        "area": {
                            "type": "string",
                            "enum": ["prompt", "tools", "flow", "latency", "voice", "other"],
                        },
                        "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                        "evidenceRefs": {"type": "array", "items": {"type": "string"}},
                    }
                ),
            },
            "strengths": {"type": "array", "items": {"type": "string"}},
        }
    ),
}

SYSTEM_PROMPT = """\
You are an expert QA reviewer of voice agents (phone assistants). You review one finished test \
call between the agent and a simulated caller, and judge the agent against the scenario's \
criteria.

## Rules
- Judge only from the evidence given in the user message. Never invent turns, tool calls, \
timings or facts that are not there.
- Give exactly one verdict per criterion, using the criterion id exactly as given.
- Verdicts: `pass` (fully met), `partial` (partly met or met with clear flaws), `fail` (not \
met or contradicted), `not_observable` (the evidence needed to judge it is missing).
- Score each criterion 0-100 (pass usually 80-100, partial 40-79, fail 0-39). The overall \
score is computed from your per-criterion scores, so be consistent.
- Use each criterion's evidence source: `transcript` criteria are judged from the numbered \
turns; `trace` criteria from the agent's trace digest (tool calls, models, errors, internal \
latencies); `timing` criteria from the turn timings and latencies. When the source a \
criterion needs is unavailable (for example traces are unavailable), answer `not_observable` \
instead of guessing from another source.
- Cite evidence for every verdict except `not_observable`: `ref` is a turn (A3 for the \
agent's third turn, C2 for the caller's second), a timing row (T4) or a trace (R2, optionally \
followed by the observation name); `quote` holds the exact words or values you relied on.
- The caller is simulated: never judge the caller, only the agent.
- Suggestions must be concrete changes to the agent's prompt, tools, conversation flow, \
latency or voice configuration that would fix an observed problem; tie each one to the \
evidence refs that show the problem. Order them by impact. No generic advice.
- Strengths: what the agent did well, briefly, if anything.
- Write in English, plainly. Answer only with the JSON object of the response schema.\
"""


def _clip(text: Any, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _block(text: Any, limit: int = MAX_CONTEXT_CHARS) -> str:
    text = str(text or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _section(title: str, body: str) -> str:
    return f"## {title}\n{body.strip() or '(none)'}"


def _clock(ms: Any) -> str:
    if not isinstance(ms, int | float):
        return "--:--"
    seconds = max(0, int(ms // 1000))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def _ms(value: Any) -> str:
    return f"{value:.0f} ms" if isinstance(value, int | float) else "-"


def render_transcript(transcript: list[dict[str, Any]]) -> str:
    """Numbered turns: A<n> for the agent, C<n> for the caller, with the mm:ss they started."""
    lines: list[str] = []
    counters = {"agent": 0, "caller": 0}
    for row in transcript[:MAX_TRANSCRIPT_ROWS]:
        role = "agent" if row.get("role") == "agent" else "caller"
        counters[role] += 1
        label = f"{'A' if role == 'agent' else 'C'}{counters[role]}"
        line = f"{label} [{_clock(row.get('start_ms'))}] {role.upper()}: "
        line += _clip(row.get("text"), MAX_ROW_CHARS)
        if role == "agent" and isinstance(row.get("latency_ms"), int | float):
            line += f" (latency {_ms(row['latency_ms'])})"
        if role == "caller" and row.get("reason"):
            line += f" (simulated caller's intent: {_clip(row['reason'], 200)})"
        lines.append(line)
    if len(transcript) > MAX_TRANSCRIPT_ROWS:
        lines.append(f"... {len(transcript) - MAX_TRANSCRIPT_ROWS} later turn(s) omitted")
    return "\n".join(lines) or "(nobody spoke)"


def render_timing(summary: dict[str, Any]) -> str:
    """The call outcome and one row per agent turn (T<n>), with latency stats."""
    duration = summary.get("duration_ms")
    lines = [
        f"Status: {summary.get('status') or 'unknown'}"
        + (f" ({_clip(summary['reason'], 300)})" if summary.get("reason") else ""),
        f"Duration: {_clock(duration)} ({_ms(duration)})",
        f"Caller turns: {summary.get('caller_turns', '-')}; "
        f"agent turns: {summary.get('agent_turns', '-')}",
    ]
    latencies = [v for v in summary.get("latencies_ms") or [] if isinstance(v, int | float)]
    if latencies:
        ordered = sorted(latencies)
        median = ordered[len(ordered) // 2]
        lines.append(
            f"Response latency (caller stops -> agent audio): median {_ms(median)}, "
            f"max {_ms(ordered[-1])}, over {len(ordered)} turn(s)"
        )
    turns = summary.get("turns") or []
    if turns:
        lines.append("")
        lines.append("| ref | kind | caller end | first audio | end | playback end | latency |")
        lines.append("|---|---|---|---|---|---|---|")
        for position, turn in enumerate(turns[:MAX_TIMING_ROWS], start=1):
            cells = [
                f"T{position}",
                str(turn.get("kind") or "-"),
                _ms(turn.get("caller_end_ms")),
                _ms(turn.get("first_audio_ms")),
                _ms(turn.get("end_ms")),
                _ms(turn.get("playback_end_ms")),
                _ms(turn.get("latency_ms")),
            ]
            if turn.get("end_reason"):
                cells[1] += f", ended by {turn['end_reason']}"
            lines.append("| " + " | ".join(cells) + " |")
        if len(turns) > MAX_TIMING_ROWS:
            lines.append(f"... {len(turns) - MAX_TIMING_ROWS} later turn(s) omitted")
    warnings = summary.get("warnings") or []
    if warnings:
        lines.append("")
        lines.append("Runner warnings:")
        lines.extend(f"- {_clip(w, 300)}" for w in warnings[:MAX_WARNINGS])
    return "\n".join(lines)


def render_criteria(criteria: list[dict[str, Any]]) -> str:
    return "\n".join(
        f"- id `{c['id']}` ({c['kind']}, source: {c['source']}, weight {c['weight']}): "
        f"{_clip(c['text'], 600)}"
        for c in criteria
    )


def render_scenario(scenario: dict[str, Any]) -> str:
    persona = scenario.get("persona") or {}
    lines = [f"Name: {scenario.get('name') or '-'}", f"Goal: {_block(scenario.get('goal'))}"]
    if persona:
        who = f"{persona.get('name', '-')} ({persona.get('locale', '-')}, "
        who += f"{persona.get('temperament', '-')})"
        if persona.get("notes"):
            who += f"; notes: {_clip(persona['notes'], 1000)}"
        lines.append(f"Simulated caller: {who}")
    if scenario.get("context"):
        lines.append(f"Context of the call:\n{_block(scenario['context'])}")
    if scenario.get("instructions"):
        lines.append(f"Caller instructions:\n{_block(scenario['instructions'])}")
    facts = scenario.get("facts") or []
    if facts:
        lines.append("Facts the caller knows (revealed only when asked):")
        lines.extend(f"- {_clip(f.get('key'), 200)}: {_clip(f.get('value'), 500)}" for f in facts)
    return "\n".join(lines)


def render_agent(agent: dict[str, Any]) -> str:
    lines = [f"Name: {agent.get('name') or '-'}", f"Protocol: {agent.get('protocol') or '-'}"]
    if agent.get("context"):
        lines.append(f"Context:\n{_block(agent['context'])}")
    return "\n".join(lines)


def render_traces(trace_digest: dict[str, Any] | None, trace_note: str | None) -> str:
    """The digest as JSON with each trace numbered R<n>, or an explicit unavailability note."""
    if trace_digest is None:
        reason = trace_note or "no trace data was collected"
        return f"Traces unavailable: {reason}. Criteria with source `trace` are not_observable."
    digest = dict(trace_digest)
    digest["traces"] = [
        {"ref": f"R{position}", **trace}
        for position, trace in enumerate(trace_digest.get("traces") or [], start=1)
    ]
    body = json.dumps(digest, ensure_ascii=False, separators=(",", ":"))
    if trace_note:
        body = f"Note: {trace_note}\n{body}"
    return "Offsets are milliseconds from the start of the call; durations and TTFT in ms.\n" + body


def build_messages(
    snapshot: dict[str, Any],
    transcript: list[dict[str, Any]],
    summary: dict[str, Any],
    trace_digest: dict[str, Any] | None,
    trace_note: str | None,
) -> list[dict[str, str]]:
    """`trace_digest` is `TraceDigest.to_prompt_dict()`, or None when traces are unavailable."""
    scenario = snapshot.get("scenario") or {}
    criteria = scenario.get("criteria") or []
    user = "\n\n".join(
        [
            _section("Criteria to judge", render_criteria(criteria)),
            _section("Scenario", render_scenario(scenario)),
            _section("Agent under test", render_agent(snapshot.get("agent") or {})),
            _section("Transcript", render_transcript(transcript)),
            _section("Timing", render_timing(summary)),
            _section("Agent traces (Langfuse)", render_traces(trace_digest, trace_note)),
            "Judge every criterion above, then give suggestions and strengths.",
        ]
    )
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]
