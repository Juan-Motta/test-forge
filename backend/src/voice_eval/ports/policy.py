"""Port for the evaluator's "brain": given the conversation so far, decide the caller's next turn.

The runner speaks `say` with the TTS provider and ends the call on `hang_up`; it never sees how
the decision was made (an LLM, a script in tests).
"""

from dataclasses import dataclass
from typing import Literal, Protocol

HangUpRule = Literal["goal_or_goodbye", "goodbye", "max_duration"]


@dataclass(frozen=True)
class CallerBrief:
    """Everything the caller is, knows and wants (the prompt inputs of one scenario run)."""

    agent_context: str
    scenario_context: str
    persona_name: str
    locale: str
    temperament: str
    persona_notes: str
    goal: str
    instructions: str
    facts: tuple[tuple[str, str], ...]  # (key, value), revealed only when asked
    hang_up_when: HangUpRule
    max_duration_s: float


@dataclass(frozen=True)
class Utterance:
    role: Literal["agent", "caller"]
    text: str


@dataclass(frozen=True)
class PolicyState:
    brief: CallerBrief
    conversation: tuple[Utterance, ...] = ()  # both sides, in order
    elapsed_s: float = 0.0
    caller_turns: int = 0


@dataclass(frozen=True)
class CallerDecision:
    """`say` None means stay silent; a decision either speaks, hangs up, or both (a farewell)."""

    say: str | None
    hang_up: bool
    reason: str


class CallerPolicy(Protocol):
    async def next_turn(self, state: PolicyState) -> CallerDecision:
        """Never raises for provider trouble: a safe hang-up with its reason instead."""
        ...
