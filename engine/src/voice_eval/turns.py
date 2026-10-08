"""Client-side end-of-turn detection.

The Live protocol has no response-done event, so an agent turn is considered over once no
agent audio (or caption change) has arrived for ``silence_gap_ms``. All times are explicit
milliseconds on a caller-chosen monotonic clock, which keeps the detector deterministic.
"""

from dataclasses import dataclass


@dataclass
class AgentTurn:
    first_audio_ms: float
    last_activity_ms: float
    caller_end_ms: float | None = None
    end_ms: float | None = None
    audio_bytes: int = 0

    @property
    def latency_ms(self) -> float | None:
        if self.caller_end_ms is None:
            return None
        return self.first_audio_ms - self.caller_end_ms


class AgentTurnDetector:
    def __init__(self, silence_gap_ms: float = 900) -> None:
        self.silence_gap_ms = silence_gap_ms
        self.completed_turns: list[AgentTurn] = []
        self._current: AgentTurn | None = None
        self._pending_caller_end: float | None = None

    @property
    def agent_speaking(self) -> bool:
        return self._current is not None

    @property
    def current_turn(self) -> AgentTurn | None:
        return self._current

    def mark_caller_end(self, now_ms: float) -> None:
        self._pending_caller_end = now_ms

    def on_agent_audio(self, now_ms: float, nbytes: int = 0) -> None:
        if self._current is None:
            self._current = AgentTurn(
                first_audio_ms=now_ms,
                last_activity_ms=now_ms,
                caller_end_ms=self._pending_caller_end,
            )
            self._pending_caller_end = None
        self._current.last_activity_ms = max(self._current.last_activity_ms, now_ms)
        self._current.audio_bytes += nbytes

    def on_caption_change(self, now_ms: float) -> None:
        if self._current is not None:
            self._current.last_activity_ms = max(self._current.last_activity_ms, now_ms)

    def turn_ended(self, now_ms: float) -> bool:
        """Close the open turn once the silence gap elapsed; True only on that transition."""
        turn = self._current
        if turn is None or now_ms - turn.last_activity_ms < self.silence_gap_ms:
            return False
        turn.end_ms = turn.last_activity_ms
        self.completed_turns.append(turn)
        self._current = None
        return True

    def latencies_ms(self) -> list[float]:
        return [t.latency_ms for t in self.completed_turns if t.latency_ms is not None]
