"""Client-side end-of-turn detection.

`AgentTurnDetector` serves protocols without a response-done event (Live): an agent turn is
over once no agent audio (or caption change) has arrived for ``silence_gap_ms``.
`ResponseTurnTracker` serves protocols with explicit response events (legacy realtime).
All times are explicit milliseconds on a caller-chosen monotonic clock, which keeps both
deterministic.
"""

from dataclasses import dataclass

from voice_eval.audio import BYTES_PER_MS


@dataclass
class AgentTurn:
    first_audio_ms: float | None
    last_activity_ms: float
    caller_end_ms: float | None = None
    end_ms: float | None = None
    audio_bytes: int = 0
    response_count: int | None = None  # None: the protocol does not report responses
    tool_activity: bool | None = None
    end_reason: str | None = None
    caller_resumed_ms: float | None = None  # when the next caller turn actually started

    @property
    def playback_end_ms(self) -> float | None:
        """When the agent audio would finish playing: it plays back-to-back from the first delta."""
        if self.first_audio_ms is None:
            return None
        return self.first_audio_ms + self.audio_bytes / BYTES_PER_MS

    @property
    def latency_ms(self) -> float | None:
        if self.caller_end_ms is None or self.first_audio_ms is None:
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

    def on_response_started(self, now_ms: float) -> None:
        """Explicit response events are ignored here (Live never sends them)."""

    def on_response_done(self, now_ms: float) -> None:
        """Explicit response events are ignored here (Live never sends them)."""

    def on_busy(self, now_ms: float) -> None:
        """Tool activity is ignored here (Live never reports it)."""

    def on_caption_change(self, now_ms: float) -> None:
        if self._current is not None:
            self._current.last_activity_ms = max(self._current.last_activity_ms, now_ms)

    def turn_ended(self, now_ms: float) -> bool:
        """Close the open turn once the silence gap elapsed; True only on that transition."""
        turn = self._current
        if turn is None or now_ms - turn.last_activity_ms < self.silence_gap_ms:
            return False
        self._close(turn, "audio_gap")
        return True

    def _close(self, turn: AgentTurn, reason: str) -> None:
        turn.end_ms = turn.last_activity_ms
        turn.end_reason = reason
        self.completed_turns.append(turn)
        self._current = None

    def discard(self, turn: AgentTurn) -> None:
        """Forget a completed turn that said nothing; the caller end it held moves to the next.

        The next turn is the one completed after it (both may close before the runner looks),
        else the open one, else the next turn to open.
        """
        index = next((i for i, t in enumerate(self.completed_turns) if t is turn), None)
        if index is None:
            raise ValueError("the turn to discard is not a completed turn")
        del self.completed_turns[index]
        if turn.caller_end_ms is None:
            return
        if index < len(self.completed_turns):
            following = self.completed_turns[index]
            if following.caller_end_ms is None:
                following.caller_end_ms = turn.caller_end_ms
        elif self._current is not None:
            if self._current.caller_end_ms is None:
                self._current.caller_end_ms = turn.caller_end_ms
        elif self._pending_caller_end is None:
            self._pending_caller_end = turn.caller_end_ms

    def latencies_ms(self) -> list[float]:
        return [t.latency_ms for t in self.completed_turns if t.latency_ms is not None]


class ResponseTurnTracker(AgentTurnDetector):
    """Agent turns delimited by explicit `response.created` / `response.done` events.

    A tool call makes the agent produce several responses in a row (function call, then
    speech) with "processing" ticks while the tool runs. The turn is over only when no response
    is open and nothing new arrived for ``settle_ms`` after the last `response.done`.

    While a response is open the turn never ends on a plain activity gap (a slow tool may run
    silently); only ``open_response_stall_ms`` without any activity ends it, as ``stalled``, so a
    dead server cannot hold the turn forever. With no response open (the response events went
    missing), an activity gap of ``fallback_gap_ms`` still ends the turn.
    """

    def __init__(
        self,
        settle_ms: float = 1200,
        fallback_gap_ms: float = 5000,
        open_response_stall_ms: float = 20000,
    ) -> None:
        super().__init__(silence_gap_ms=fallback_gap_ms)
        self.settle_ms = settle_ms
        self.open_response_stall_ms = open_response_stall_ms
        self._open_responses = 0
        self._done_seen = False

    def _open(self, now_ms: float) -> AgentTurn:
        if self._current is None:
            self._current = AgentTurn(
                first_audio_ms=None,
                last_activity_ms=now_ms,
                caller_end_ms=self._pending_caller_end,
                response_count=0,
                tool_activity=False,
            )
            self._pending_caller_end = None
            self._open_responses = 0
            self._done_seen = False
        turn = self._current
        turn.last_activity_ms = max(turn.last_activity_ms, now_ms)
        return turn

    def on_response_started(self, now_ms: float) -> None:
        turn = self._open(now_ms)
        turn.response_count = (turn.response_count or 0) + 1
        self._open_responses += 1

    def on_response_done(self, now_ms: float) -> None:
        if self._current is None:
            return
        self._open(now_ms)
        self._open_responses = max(0, self._open_responses - 1)
        self._done_seen = True

    def on_busy(self, now_ms: float) -> None:
        self._open(now_ms).tool_activity = True

    def on_agent_audio(self, now_ms: float, nbytes: int = 0) -> None:
        turn = self._open(now_ms)
        if turn.first_audio_ms is None:
            turn.first_audio_ms = now_ms
        turn.audio_bytes += nbytes

    def turn_ended(self, now_ms: float) -> bool:
        turn = self._current
        if turn is None:
            return False
        idle_ms = now_ms - turn.last_activity_ms
        if self._open_responses > 0:
            if idle_ms >= self.open_response_stall_ms:
                self._close(turn, "stalled")
                return True
            return False
        if self._done_seen and idle_ms >= self.settle_ms:
            self._close(turn, "response_done")
            return True
        if idle_ms >= self.silence_gap_ms:
            self._close(turn, "fallback_gap")
            return True
        return False
