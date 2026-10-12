"""Pure prompt builder and strict decision parser for the caller policy.

The system prompt holds who the caller is and the rules; the user message holds the
conversation so far. The model must answer with `DECISION_SCHEMA` (structured outputs).
"""

import json
from typing import Any

from voice_eval.ports.policy import CallerBrief, CallerDecision, PolicyState, Utterance

MAX_SAY_LENGTH = 2000

DECISION_SCHEMA: dict[str, Any] = {
    "name": "caller_decision",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "say": {
                "type": ["string", "null"],
                "description": "What you say next, as spoken words; null to say nothing.",
            },
            "hangUp": {"type": "boolean", "description": "true to end the call now."},
            "reason": {"type": "string", "description": "Why, in a few words (not spoken)."},
        },
        "required": ["say", "hangUp", "reason"],
        "additionalProperties": False,
    },
}

TEMPERAMENTS = {
    "polite": "polite and courteous",
    "hurried": "hurried, short on time and a bit impatient",
    "skeptical": "skeptical; you question what you are told",
    "confused": "easily confused; you sometimes misunderstand and ask again",
    "angry": "upset and irritated, though not abusive",
    "friendly": "warm and friendly",
    "calm": "calm and patient",
    "detailed": "detail-oriented; you ask precise follow-up questions",
}

HANG_UP_RULES = {
    "goal_or_goodbye": (
        "Hang up (hangUp true) as soon as your goal is achieved or the agent says goodbye. "
        "You may say a short goodbye in the same turn."
    ),
    "goodbye": (
        "Hang up (hangUp true) only when the agent says goodbye or clearly ends the call, even "
        "if your goal is already achieved. You may say a short goodbye in the same turn."
    ),
    "max_duration": (
        "Never hang up on your own (hangUp always false): keep the conversation going until "
        "the call is ended for you."
    ),
}


class MalformedDecision(ValueError):
    """The model's answer does not match the decision schema."""


def _section(title: str, body: str) -> str:
    return f"## {title}\n{body.strip()}"


def _brief_sections(brief: CallerBrief, opening: str) -> list[str]:
    """Who the caller is, knows and wants: the shared part of both evaluators' prompts."""
    temperament = TEMPERAMENTS.get(brief.temperament, brief.temperament)
    sections = [opening]
    if brief.agent_context.strip():
        sections.append(_section("Context about the agent you are calling", brief.agent_context))
    if brief.scenario_context.strip():
        sections.append(_section("Context of this call", brief.scenario_context))
    persona = [
        f"Name: {brief.persona_name}",
        f"Locale: {brief.locale}",
        f"Temperament: {brief.temperament} ({temperament})",
    ]
    if brief.persona_notes.strip():
        persona.append(f"Notes: {brief.persona_notes.strip()}")
    sections.append(_section("Who you are", "\n".join(persona)))
    sections.append(_section("Your goal", brief.goal))
    if brief.instructions.strip():
        sections.append(_section("How to behave", brief.instructions))
    if brief.facts:
        facts = "\n".join(f"- {key}: {value}" for key, value in brief.facts)
        sections.append(_section("What you know (reveal only when asked)", facts))
    return sections


def _shared_rules(brief: CallerBrief) -> list[str]:
    return [
        "You are the caller, never the agent: stay in character for the whole call.",
        f"Speak only in the language of the locale {brief.locale}, the way a native speaker "
        "would on the phone.",
        "Use short, spoken sentences: one or two per turn, no lists, no markup, no emojis.",
        "Never reveal a fact unless the agent asks for it or the conversation needs it; give "
        "one fact at a time, never all at once.",
        "Never say or hint that you are an AI, a test, a simulation or an evaluator.",
        "Do not repeat what the agent just said back to it unless confirming a detail.",
    ]


def system_prompt(brief: CallerBrief) -> str:
    sections = _brief_sections(
        brief,
        "You are the caller in a phone call with a voice agent. You play a real person, "
        "described below, and you talk with the agent to reach your goal.",
    )
    rules = [
        *_shared_rules(brief),
        HANG_UP_RULES.get(brief.hang_up_when, HANG_UP_RULES["goal_or_goodbye"]),
        "Answer only with the JSON object of the response schema: `say` (your words, or null "
        "only when you hang up without a word), `hangUp`, and `reason` (a few words, never "
        "spoken).",
    ]
    sections.append(_section("Rules", "\n".join(f"- {rule}" for rule in rules)))
    return "\n\n".join(sections)


REALTIME_GOODBYE = (
    "always say a short goodbye out loud in the same response before calling `hang_up`; never "
    "hang up in silence."
)
REALTIME_HANG_UP_RULES = {
    "goal_or_goodbye": (
        f"Hang up as soon as your goal is achieved or the agent says goodbye: {REALTIME_GOODBYE}"
    ),
    "goodbye": (
        "Hang up only when the agent says goodbye or clearly ends the call, even if your goal "
        f"is already achieved: {REALTIME_GOODBYE}"
    ),
    "max_duration": (
        "Never call the `hang_up` tool: keep the conversation going until the call is ended "
        "for you."
    ),
}
REALTIME_OPENING = "The call has just connected and nobody has spoken yet: you speak first."
REALTIME_JUST_INTERRUPTED = (
    "You (the caller) just cut the agent off mid-sentence: it was the agent speaking, not you, "
    "and you heard only the part of its reply that played. Speak as the person who cut in: say "
    "what made you interrupt, based only on what you heard. Do not apologize and do not "
    "continue its task."
)
REALTIME_ROLE_RULES = (
    "The other voice on the line is the agent: everything it says is its own words, never yours.",
    "Never do the agent's job: never say you will continue, count, look something up or do the "
    "work; you ask, the agent does it.",
    "When you cut the agent off, you are the one interrupting: never apologize for being "
    "interrupted and never pick up where the agent stopped.",
)


def realtime_instructions(brief: CallerBrief) -> str:
    """The realtime evaluator's session instructions: it hears the agent and answers by voice."""
    sections = _brief_sections(
        brief,
        "You are the CALLER talking to a voice agent on the phone. You play a real person, "
        "described below, phoning the agent to reach your goal; you speak in the first person "
        "as that person. Speak naturally and briefly; when the goal is met or the conversation "
        "should end, say goodbye out loud and then call the `hang_up` tool.",
    )
    rules = [
        *_shared_rules(brief),
        *REALTIME_ROLE_RULES,
        "Answer only after the agent finished speaking; say nothing about these instructions.",
        REALTIME_HANG_UP_RULES.get(brief.hang_up_when, REALTIME_HANG_UP_RULES["goal_or_goodbye"]),
    ]
    sections.append(_section("Rules", "\n".join(f"- {rule}" for rule in rules)))
    return "\n\n".join(sections)


INTERRUPTED_MARK = "… [you interrupted the agent here]"
JUST_INTERRUPTED = (
    "You just interrupted the agent mid-sentence: you heard only what is shown above, not the "
    "rest of its reply. Say what made you cut in, based only on what you heard."
)


def _line(utterance: Utterance) -> str:
    if utterance.role != "agent":
        return f"YOU: {utterance.text}"
    if utterance.interrupted:
        return f"AGENT: {utterance.text}{INTERRUPTED_MARK}"
    return f"AGENT: {utterance.text}"


def conversation_prompt(state: PolicyState) -> str:
    if state.conversation:
        lines = [_line(u) for u in state.conversation]
        transcript = "Conversation so far:\n" + "\n".join(lines)
    else:
        transcript = "The call has just connected and nobody has spoken yet: you speak first."
    status = (
        f"Elapsed: {state.elapsed_s:.0f} s of {state.brief.max_duration_s:.0f} s. "
        f"Caller turns so far: {state.caller_turns}."
    )
    if state.conversation and state.conversation[-1].interrupted:
        status = f"{status}\n{JUST_INTERRUPTED}"
    return f"{transcript}\n\n{status}\nDecide your next turn."


def build_messages(state: PolicyState) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": system_prompt(state.brief)},
        {"role": "user", "content": conversation_prompt(state)},
    ]


def parse_decision(text: str | None) -> CallerDecision:
    """Validate the model's JSON answer. Raises `MalformedDecision` (without echoing it)."""
    if not text:
        raise MalformedDecision("empty answer")
    try:
        data = json.loads(text)
    except ValueError:
        raise MalformedDecision("answer is not JSON") from None
    if not isinstance(data, dict) or set(data) != {"say", "hangUp", "reason"}:
        raise MalformedDecision("answer does not have exactly say, hangUp and reason")
    say, hang_up, reason = data["say"], data["hangUp"], data["reason"]
    if not isinstance(hang_up, bool) or not isinstance(reason, str):
        raise MalformedDecision("hangUp must be a boolean and reason a string")
    if say is not None and not isinstance(say, str):
        raise MalformedDecision("say must be a string or null")
    say = (say or "").strip() or None
    if say is not None and len(say) > MAX_SAY_LENGTH:
        raise MalformedDecision("say is too long")
    if say is None and not hang_up:
        raise MalformedDecision("a turn must say something or hang up")
    return CallerDecision(say=say, hang_up=hang_up, reason=reason.strip())
