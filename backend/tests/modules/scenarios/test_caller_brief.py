"""The evaluator's brief built from a stored scenario and its agent's shared context."""

import uuid
from datetime import UTC, datetime

from voice_eval.modules.scenarios.domain import (
    AgentSummary,
    Criterion,
    EndConditions,
    Fact,
    Persona,
    Scenario,
    caller_brief,
)
from voice_eval.ports.policy import CallerBrief


def test_caller_brief_from_a_scenario():
    now = datetime.now(UTC)
    scenario = Scenario(
        id=uuid.uuid4(),
        agent=AgentSummary(id=uuid.uuid4(), name="Hotel"),
        name="Late check-out",
        tags=[],
        context="Loyalty member.",
        persona=Persona(name="Lucía", locale="es-MX", temperament="hurried", notes="In a car."),
        tts_connection_id=None,
        evaluator_connection_id=None,
        voice_override=None,
        goal="Leave at 2 pm.",
        instructions="Ask the fee.",
        facts=[Fact(key="Room", value="412")],
        criteria=[Criterion(text="x", kind="must", source="transcript", weight=100)],
        end_conditions=EndConditions(max_duration_s=300, hang_up_when="goodbye"),
        created_at=now,
        updated_at=now,
    )
    assert caller_brief(scenario, agent_context="Hotel Mirador desk.") == CallerBrief(
        agent_context="Hotel Mirador desk.",
        scenario_context="Loyalty member.",
        persona_name="Lucía",
        locale="es-MX",
        temperament="hurried",
        persona_notes="In a car.",
        goal="Leave at 2 pm.",
        instructions="Ask the fee.",
        facts=(("Room", "412"),),
        hang_up_when="goodbye",
        max_duration_s=300,
    )
