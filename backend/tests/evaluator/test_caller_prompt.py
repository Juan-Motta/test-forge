"""The evaluator's prompt and the strict decision it must answer with."""

import json

import pytest

from voice_eval.evaluator.prompt import (
    DECISION_SCHEMA,
    MalformedDecision,
    build_messages,
    conversation_prompt,
    parse_decision,
    system_prompt,
)
from voice_eval.ports.policy import CallerBrief, CallerDecision, PolicyState, Utterance

BRIEF = CallerBrief(
    agent_context="Voice receptionist of Hotel Mirador.",
    scenario_context="The guest is a loyalty member.",
    persona_name="Lucía",
    locale="es-MX",
    temperament="hurried",
    persona_notes="Calls from her car.",
    goal="Get a late check-out at 2 pm.",
    instructions="Ask about the fee before accepting.",
    facts=(("Room", "412"), ("Loyalty number", "LM-778")),
    hang_up_when="goal_or_goodbye",
    max_duration_s=360,
)


def test_system_prompt_carries_every_brief_part_in_order():
    prompt = system_prompt(BRIEF)
    parts = [
        "Voice receptionist of Hotel Mirador.",
        "The guest is a loyalty member.",
        "Lucía",
        "es-MX",
        "hurried",
        "Calls from her car.",
        "Get a late check-out at 2 pm.",
        "Ask about the fee before accepting.",
        "- Room: 412",
        "- Loyalty number: LM-778",
    ]
    positions = [prompt.index(part) for part in parts]
    assert positions == sorted(positions)


@pytest.mark.parametrize(
    "rule",
    [
        "You are the caller",
        "Speak only in the language of the locale es-MX",
        "short, spoken sentences",
        "Never reveal a fact unless the agent asks for it",
        "never all at once",
        "Never say or hint that you are an AI",
        "goal is achieved or the agent says goodbye",
        "Answer only with the JSON object",
    ],
)
def test_system_prompt_states_the_rules(rule):
    assert rule in system_prompt(BRIEF)


def test_hang_up_rule_follows_the_scenario():
    goodbye = system_prompt(BRIEF.__class__(**{**BRIEF.__dict__, "hang_up_when": "goodbye"}))
    assert "only when the agent says goodbye" in goodbye
    assert "goal is achieved or" not in goodbye
    never = system_prompt(BRIEF.__class__(**{**BRIEF.__dict__, "hang_up_when": "max_duration"}))
    assert "Never hang up" in never


def test_empty_optional_parts_are_left_out():
    bare = BRIEF.__class__(
        **{
            **BRIEF.__dict__,
            "agent_context": "",
            "scenario_context": "",
            "persona_notes": "",
            "instructions": "",
            "facts": (),
        }
    )
    prompt = system_prompt(bare)
    assert "Context" not in prompt
    assert "Notes" not in prompt
    assert "How to behave" not in prompt
    assert "What you know" not in prompt


def test_opening_turn_prompt_says_the_call_just_connected():
    prompt = conversation_prompt(PolicyState(brief=BRIEF))
    assert "The call has just connected" in prompt
    assert "Elapsed: 0 s of 360 s" in prompt
    assert "Caller turns so far: 0" in prompt


def test_conversation_prompt_lists_both_sides_in_order():
    state = PolicyState(
        brief=BRIEF,
        conversation=(
            Utterance("agent", "Hotel Mirador, ¿en qué le ayudo?"),
            Utterance("caller", "Quiero salir más tarde."),
            Utterance("agent", "¿Cuál es su número de habitación?"),
        ),
        elapsed_s=42.4,
        caller_turns=1,
    )
    prompt = conversation_prompt(state)
    assert (
        "AGENT: Hotel Mirador, ¿en qué le ayudo?\n"
        "YOU: Quiero salir más tarde.\n"
        "AGENT: ¿Cuál es su número de habitación?"
    ) in prompt
    assert "Elapsed: 42 s of 360 s" in prompt
    assert "Caller turns so far: 1" in prompt


def test_an_interrupted_agent_line_shows_only_what_was_heard_and_where_you_cut_in():
    state = PolicyState(
        brief=BRIEF,
        conversation=(
            Utterance("caller", "Quiero salir más tarde."),
            Utterance("agent", "Claro, el horario de salida", interrupted=True),
        ),
        caller_turns=1,
    )
    prompt = conversation_prompt(state)
    assert "AGENT: Claro, el horario de salida… [you interrupted the agent here]" in prompt
    assert "You just interrupted the agent" in prompt
    plain = conversation_prompt(
        PolicyState(brief=BRIEF, conversation=(Utterance("agent", "Hola"),))
    )
    assert "interrupt" not in plain


def test_messages_are_system_then_user():
    state = PolicyState(brief=BRIEF)
    assert build_messages(state) == [
        {"role": "system", "content": system_prompt(BRIEF)},
        {"role": "user", "content": conversation_prompt(state)},
    ]


def test_schema_is_strict():
    assert DECISION_SCHEMA["strict"] is True
    schema = DECISION_SCHEMA["schema"]
    assert schema["required"] == ["say", "hangUp", "reason"]
    assert schema["additionalProperties"] is False


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            '{"say": "Hola", "hangUp": false, "reason": "greet"}',
            CallerDecision("Hola", False, "greet"),
        ),
        ('{"say": null, "hangUp": true, "reason": "done"}', CallerDecision(None, True, "done")),
        ('{"say": "  ", "hangUp": true, "reason": "bye"}', CallerDecision(None, True, "bye")),
        (
            '{"say": " Adiós. ", "hangUp": true, "reason": "goal met"}',
            CallerDecision("Adiós.", True, "goal met"),
        ),
    ],
)
def test_parse_decision(text, expected):
    assert parse_decision(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        None,
        "",
        "not json",
        "[]",
        '{"say": "x", "hangUp": "no", "reason": "r"}',
        '{"say": 3, "hangUp": false, "reason": "r"}',
        '{"say": "x", "hangUp": false}',
        '{"say": null, "hangUp": false, "reason": "r"}',  # silent and staying: nothing to do
        json.dumps({"say": "x" * 2001, "hangUp": False, "reason": "r"}),
    ],
)
def test_parse_decision_rejects_malformed_output(text):
    with pytest.raises(MalformedDecision):
        parse_decision(text)
