"""Run events: what a live monitor (or a test) sees while a conversation runs.

Types, in the order a run produces them: `run_started`, `protocol_detected`, then any of
`agent_audio`, `agent_transcript`, `turn_ended`, `caller_decision`, `caller_audio`, `warning`,
`caller_speaking` (the first frame of a decision's words was sent), `caller_decision_discarded`
(the agent spoke again before a decision was said; the policy decides again), `agent_barge_in`
(an agent turn started while the caller was mid-utterance), and last `run_finished`.
`caller_decision`, `caller_speaking` and `caller_decision_discarded` carry the decision's
`decision_id` (from 1). Audio events carry their PCM16 24 kHz mono chunk in `pcm`, which never
goes into `events.jsonl`.
"""

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class RunEvent:
    type: str
    t_ms: float  # since the run started
    data: dict[str, Any] = field(default_factory=dict)
    pcm: bytes | None = field(default=None, repr=False)

    def record(self) -> dict[str, Any]:
        """The event as written to `events.jsonl` (no audio payload)."""
        return {"type": self.type, "t_ms": self.t_ms, **self.data}


class EventSink(Protocol):
    async def emit(self, event: RunEvent) -> None:
        """Receive one event; the runner delivers them in order and survives a failing sink."""
        ...
