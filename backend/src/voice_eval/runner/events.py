"""Run events: what a live monitor (or a test) sees while a conversation runs.

Types, in the order a run produces them: `run_started`, `protocol_detected`, then any of
`agent_audio`, `agent_transcript`, `turn_ended`, `caller_decision`, `caller_audio`, `warning`,
`caller_speaking` (the first frame of a decision's words was sent), `caller_decision_discarded`
(the agent spoke again before a decision was said; the policy decides again), `agent_barge_in`
(an agent turn started while the caller was mid-utterance), `caller_interrupted` (the caller cut
the agent off: `agent_turn`, `audio_end_ms`, `heard_text`), `interruption_confirmed` (the agent's
server applied the cut to one reported audio item: `agent_turn`, `item_id`, `kind` = `truncated`
| `deleted`, `audio_end_ms` as the server applied it; it may arrive after later turns), and last
`run_finished`. The `agent_transcript` of an interrupted turn also carries `interrupted`,
`heard_text`, `heard_text_estimated` (always true: the played share of the audio applied to the
text), `audio_end_ms` and `interruption_confirmed` (as of that moment).
`caller_speech_synthesized` (the decision's streamed synthesis ended) may come before or after
its `caller_speaking`.
`caller_decision`, `caller_speaking`, `caller_speech_synthesized` and `caller_decision_discarded`
carry the decision's `decision_id` (from 1). Latency timings, in ms: `caller_decision` has
`started_ms` (run time the policy was asked) and `duration_ms`; `caller_speaking` has
`tts_first_chunk_ms` (synthesis start to its first chunk); `caller_speech_synthesized` has
`tts_first_chunk_ms` and `tts_total_ms`. Audio events carry their PCM16 24 kHz mono chunk in
`pcm`, which never goes into `events.jsonl`.
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
