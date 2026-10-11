"""Session runner: one conversation between the policy-driven caller and the agent under test.

The agent's own transcript (legacy `response.output_audio_transcript.done`, Live captions) is
what the policy hears; its decision is spoken with the TTS provider over the open-microphone
caller stream. Turn-taking is playback-aware: the caller speaks, and hangs up, only once the
agent's last reply would have finished playing. The run ends when the caller hangs up, the agent
ends the session, or an end condition (max duration, max silence) is reached; it always closes
the session and writes its artifacts.
"""

import asyncio
import logging
import time
from collections import Counter
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from websockets.exceptions import ConnectionClosed, WebSocketException

from voice_eval.caller_stream import CallerAudioStream
from voice_eval.ports.policy import (
    CallerBrief,
    CallerDecision,
    CallerPolicy,
    PolicyState,
    Utterance,
)
from voice_eval.ports.target import (
    AgentBusy,
    AudioDelta,
    Closed,
    Ready,
    ResponseDone,
    ResponseStarted,
    ServerError,
    ServerEvent,
    TargetSession,
    TranscriptMessage,
    TranscriptUpdate,
)
from voice_eval.ports.tts import SpeechSynthesizer, SynthesisError
from voice_eval.runner.artifacts import write_artifacts
from voice_eval.runner.common import close_session, make_detector, rounded, turn_record
from voice_eval.runner.events import EventSink, RunEvent
from voice_eval.targets.detect import ProtocolDetectionError, TargetSpec, open_target
from voice_eval.turns import AgentTurn, AgentTurnDetector

log = logging.getLogger(__name__)

POLL_S = 0.05


@dataclass
class SessionOptions:
    """End conditions (from the scenario) and turn-taking tuning."""

    max_duration_s: float = 360
    max_silence_s: float = 15  # no agent audio and no caller speech for this long
    hang_up_when: str = "goal_or_goodbye"
    silence_gap_ms: int = 900
    settle_ms: int = 1200
    open_response_stall_ms: int = 20000
    ready_timeout_s: float = 15
    close_timeout_s: float = 5
    trailing_silence_ms: int = 600
    playback_grace_ms: int = 400
    tts_timeout_s: float = 30


class Stop(Exception):
    """The conversation is over: `status` is completed, failed or cancelled."""

    def __init__(self, status: str, reason: str, message: str | None = None) -> None:
        super().__init__(reason)
        self.status = status
        self.reason = reason
        self.message = message


class AgentTextTracker:
    """The agent text added to the adapter's transcript since the previous call."""

    def __init__(self) -> None:
        self._seen: dict[str, str] = {}

    def take(self, messages: list[TranscriptMessage]) -> str:
        parts = []
        for message in messages:
            if message.role != "assistant":
                continue
            old = self._seen.get(message.message_id, "")
            if message.text == old:
                continue
            new = message.text[len(old) :] if message.text.startswith(old) else message.text
            self._seen[message.message_id] = message.text
            if new.strip():
                parts.append(new.strip())
        return " ".join(parts)


@dataclass
class SessionRunner:
    spec: TargetSpec
    brief: CallerBrief
    policy: CallerPolicy
    synthesizer: SpeechSynthesizer
    sink: EventSink
    out_dir: Path
    options: SessionOptions = field(default_factory=SessionOptions)

    def __post_init__(self) -> None:
        self.session: TargetSession | None = None
        self.detector = AgentTurnDetector(self.options.silence_gap_ms)
        self.stream: CallerAudioStream | None = None
        self.events: list[dict[str, Any]] = []
        self.agent_pcm = bytearray()
        self.conversation: list[Utterance] = []
        self.transcript: list[dict[str, Any]] = []
        self.warnings: list[str] = []
        self.caller_turns = 0
        self.status: str | None = None
        self.reason: str | None = None
        self.closed: Closed | None = None
        self._ready = asyncio.Event()
        self._queue: asyncio.Queue[RunEvent | None] = asyncio.Queue()
        self._text = AgentTextTracker()
        self._reported_turns = 0
        self._last_activity_ms = 0.0
        self._agent_chunks = 0
        self._caller_chunks = 0
        self._t0 = time.monotonic()
        self._started_at = datetime.now(UTC)
        self._reader: asyncio.Task[None] | None = None
        self._sender: asyncio.Task[None] | None = None

    def _now_ms(self) -> float:
        return (time.monotonic() - self._t0) * 1000

    # --- events ---------------------------------------------------------------------------

    def _publish(self, kind: str, data: dict[str, Any], pcm: bytes | None = None) -> None:
        event = RunEvent(kind, round(self._now_ms(), 1), data, pcm)
        self.events.append(event.record())
        self._queue.put_nowait(event)

    def _warn(self, message: str) -> None:
        self.warnings.append(message)
        self._publish("warning", {"message": message})

    async def _dispatch(self) -> None:
        while (event := await self._queue.get()) is not None:
            try:
                await self.sink.emit(event)
            except Exception as exc:  # a broken monitor must not break the run
                log.warning("run event sink failed (%s)", type(exc).__name__)

    # --- lifecycle ------------------------------------------------------------------------

    async def run(self) -> dict[str, Any]:
        """Hold the conversation; return the summary (also written to `summary.json`)."""
        self._t0 = time.monotonic()
        self._started_at = datetime.now(UTC)
        dispatcher = asyncio.create_task(self._dispatch())
        self._publish(
            "run_started",
            {
                "thread_id": self.spec.thread_id,
                "channel_id": self.spec.channel_id,
                "max_duration_s": self.options.max_duration_s,
                "max_silence_s": self.options.max_silence_s,
                "hang_up_when": self.options.hang_up_when,
            },
        )
        try:
            try:
                await self._converse()
            except Stop as stop:
                self._finish(stop.status, stop.reason, stop.message)
            except asyncio.CancelledError:
                self._finish("cancelled", "cancelled")
                raise
            except Exception as exc:  # a bug must still close the session and leave artifacts
                log.exception("session runner failed")
                self._finish("failed", "internal_error", f"internal error ({type(exc).__name__})")
            finally:
                await self._shutdown()
        finally:
            self._publish("run_finished", {"status": self.status, "reason": self.reason})
            self._queue.put_nowait(None)
            await asyncio.shield(dispatcher)
            summary = self.summary()
            write_artifacts(
                self.out_dir,
                events=self.events,
                agent_pcm=bytes(self.agent_pcm),
                caller_pcm=bytes(self.stream.sent if self.stream else b""),
                transcript=self.transcript,
                summary=summary,
            )
        return summary

    def _finish(self, status: str, reason: str, message: str | None = None) -> None:
        if self.status is not None:
            return
        self.status, self.reason = status, reason
        if message:
            self._warn(message)

    async def _converse(self) -> None:
        try:
            self.session = await open_target(self.spec, self.options.ready_timeout_s)
        except ProtocolDetectionError as exc:
            raise Stop("failed", "protocol_error", str(exc)) from None
        except (OSError, TimeoutError, WebSocketException) as exc:
            raise Stop(
                "failed", "connect_failed", f"could not connect ({type(exc).__name__})"
            ) from None
        self.detector = make_detector(
            self.session,
            silence_gap_ms=self.options.silence_gap_ms,
            settle_ms=self.options.settle_ms,
            open_response_stall_ms=self.options.open_response_stall_ms,
        )
        self.stream = CallerAudioStream(self._send_caller_audio, self._now_ms)
        self._reader = asyncio.create_task(self._read())
        try:
            await asyncio.wait_for(self._ready.wait(), self.options.ready_timeout_s)
        except TimeoutError:
            raise Stop(
                "failed", "ready_timeout", "session ready event not received in time"
            ) from None
        self._sender = asyncio.create_task(self.stream.run())
        self._last_activity_ms = self._now_ms()
        remaining_s = max(0.0, self.options.max_duration_s - self._now_ms() / 1000)
        try:
            async with asyncio.timeout(remaining_s) as deadline:
                await self._loop(self.session)
        except TimeoutError:
            if deadline.expired():
                raise Stop("completed", "max_duration") from None
            raise

    async def _loop(self, session: TargetSession) -> None:
        if session.agent_speaks_first:
            await self._agent_turn()
        while True:
            decision = await self._decide()
            if decision.hang_up and self.options.hang_up_when == "max_duration":
                self._warn("the caller tried to hang up; this scenario ends only at max duration")
                decision = CallerDecision(decision.say, False, decision.reason)
            if decision.say is None:
                if decision.hang_up:
                    await self._wait_playback()
                    raise Stop("completed", "caller_hung_up")
                await self._agent_turn()  # nothing to say: listen
                continue
            pcm = await self._synthesize(decision.say)
            await self._wait_playback()
            said = self._speak(decision, pcm)
            if decision.hang_up:
                await self._wait_until(said.is_set)
                raise Stop("completed", "caller_hung_up")
            await self._agent_turn()

    async def _shutdown(self) -> None:
        if self._sender is not None:
            self._sender.cancel()
            with suppress(asyncio.CancelledError, ConnectionClosed):
                await self._sender
        if self.session is None:
            return
        if self._reader is None:
            self._reader = asyncio.create_task(self._read())
        for warning in await close_session(
            self.session, self._reader, timeout_s=self.options.close_timeout_s
        ):
            self._warn(warning)
        self.detector.turn_ended(self._now_ms())

    # --- turns ----------------------------------------------------------------------------

    async def _decide(self) -> CallerDecision:
        state = PolicyState(
            brief=self.brief,
            conversation=tuple(self.conversation),
            elapsed_s=self._now_ms() / 1000,
            caller_turns=self.caller_turns,
        )
        try:
            decision = await self.policy.next_turn(state)
        except Exception as exc:
            raise Stop(
                "failed", "evaluator_failed", f"evaluator failed ({type(exc).__name__})"
            ) from None
        self._publish(
            "caller_decision",
            {"say": decision.say, "hang_up": decision.hang_up, "reason": decision.reason},
        )
        return decision

    async def _synthesize(self, text: str) -> bytes:
        try:
            async with asyncio.timeout(self.options.tts_timeout_s):
                return await self.synthesizer.synthesize(text)
        except SynthesisError as exc:
            message = f"speech synthesis failed ({exc})"
        except TimeoutError:
            message = "speech synthesis timed out"
        except Exception as exc:  # provider errors may quote request details: type only
            message = f"speech synthesis failed ({type(exc).__name__})"
        raise Stop("failed", "tts_failed", message)

    def _speak(self, decision: CallerDecision, pcm: bytes) -> asyncio.Event:
        """Queue the caller's words; the returned event is set once the last word was sent."""
        assert self.stream is not None and decision.say is not None
        said = asyncio.Event()
        row: dict[str, Any] = {
            "role": "caller",
            "text": decision.say,
            "start_ms": None,
            "end_ms": None,
            "reason": decision.reason,
        }
        completed = self.detector.completed_turns
        previous = completed[-1] if completed else None

        def started(now_ms: float) -> None:
            row["start_ms"] = rounded(now_ms)
            if previous is not None and previous.caller_resumed_ms is None:
                previous.caller_resumed_ms = now_ms

        def ended(now_ms: float) -> None:
            row["end_ms"] = rounded(now_ms)
            self.detector.mark_caller_end(now_ms)
            said.set()

        self.transcript.append(row)
        self.conversation.append(Utterance("caller", decision.say))
        self.caller_turns += 1
        self.stream.enqueue(pcm, self.options.trailing_silence_ms, ended, started)
        return said

    async def _agent_turn(self) -> None:
        """Wait for the agent's next turn (and any turn it chains) to end; report what it said."""
        await self._wait_until(
            lambda: (
                len(self.detector.completed_turns) > self._reported_turns
                and not self.detector.agent_speaking
            ),
            check_silence=True,
        )
        new_turns = self.detector.completed_turns[self._reported_turns :]
        self._reported_turns = len(self.detector.completed_turns)
        for turn in new_turns:
            self._publish(
                "turn_ended",
                {
                    "turn": self.detector.completed_turns.index(turn),
                    "first_audio_ms": rounded(turn.first_audio_ms),
                    "end_ms": rounded(turn.end_ms),
                    "playback_end_ms": rounded(turn.playback_end_ms),
                    "latency_ms": rounded(turn.latency_ms),
                    "end_reason": turn.end_reason,
                },
            )
        assert self.session is not None
        text = self._text.take(self.session.transcript_messages())
        last = new_turns[-1]
        if not text:
            self._warn("the agent turn had no transcript")
            return
        self.conversation.append(Utterance("agent", text))
        self.transcript.append(_agent_row(text, last, new_turns[0]))
        self._publish("agent_transcript", {"turn": self._reported_turns - 1, "text": text})

    async def _wait_playback(self) -> None:
        """Hold until the last agent turn would have finished playing (plus a short grace)."""
        completed = self.detector.completed_turns
        playback_end = completed[-1].playback_end_ms if completed else None
        if playback_end is None:
            return
        target_ms = playback_end + self.options.playback_grace_ms
        await self._wait_until(lambda: self._now_ms() >= target_ms)

    async def _wait_until(self, done: Any, *, check_silence: bool = False) -> None:
        while True:
            self.detector.turn_ended(self._now_ms())
            if done():
                return
            if self._reader is not None and self._reader.done():
                if self.closed is not None:
                    raise Stop("completed", "agent_ended")
                raise Stop("failed", "connection_closed", "the agent connection closed")
            if check_silence and self._silent_for_ms() >= self.options.max_silence_s * 1000:
                raise Stop("completed", "max_silence")
            await asyncio.sleep(POLL_S)

    def _silent_for_ms(self) -> float:
        now = self._now_ms()
        if self.stream is not None and not self.stream.idle:
            return 0.0  # the caller is speaking
        turns = list(self.detector.completed_turns)
        if self.detector.current_turn is not None:
            turns.append(self.detector.current_turn)
        playback_ends = [t.playback_end_ms for t in turns[-1:] if t.playback_end_ms is not None]
        quiet_since = max([self._last_activity_ms, *playback_ends])
        return max(0.0, now - quiet_since)

    # --- wire -----------------------------------------------------------------------------

    async def _send_caller_audio(self, pcm: bytes) -> None:
        assert self.session is not None
        await self.session.send_caller_audio(pcm)
        if any(pcm):  # speech, not the open microphone's silence
            self._last_activity_ms = self._now_ms()
            self._caller_chunks += 1
            self._publish("caller_audio", {"chunk": self._caller_chunks, "bytes": len(pcm)}, pcm)

    async def _read(self) -> None:
        assert self.session is not None
        try:
            async for event in self.session.events():
                self._on_event(self._now_ms(), event)
        except Exception as exc:  # keep the run alive long enough to close and write artifacts
            self._warn(f"reader failed ({type(exc).__name__})")

    def _on_event(self, t: float, event: ServerEvent) -> None:
        match event:
            case AudioDelta(pcm=pcm):
                self.agent_pcm += pcm
                self.detector.on_agent_audio(t, len(pcm))
                self._last_activity_ms = t
                self._agent_chunks += 1
                self._publish("agent_audio", {"chunk": self._agent_chunks, "bytes": len(pcm)}, pcm)
            case Ready():
                assert self.session is not None
                self._publish(
                    "protocol_detected",
                    {
                        "protocol": self.session.protocol,
                        "session_id": self.session.session_id,
                        "model": self.session.model,
                    },
                )
                self._ready.set()
            case TranscriptUpdate(role="assistant"):
                self.detector.on_caption_change(t)
            case ResponseStarted():
                self.detector.on_response_started(t)
                self._last_activity_ms = t
            case ResponseDone():
                self.detector.on_response_done(t)
                self._last_activity_ms = t
            case AgentBusy():
                self.detector.on_busy(t)
                self._last_activity_ms = t
            case ServerError(message=message):
                self._warn(f"server error: {message}")
            case Closed():
                self.closed = event

    # --- results --------------------------------------------------------------------------

    def summary(self) -> dict[str, Any]:
        session = self.session
        turns = list(self.detector.completed_turns)
        if self.detector.current_turn is not None:
            turns.append(self.detector.current_turn)
        greets = bool(session and session.agent_speaks_first)
        return {
            "status": self.status,
            "reason": self.reason,
            "protocol": session.protocol if session else None,
            "model": session.model if session else None,
            "thread_id": self.spec.thread_id,
            "langfuse_session_id": self.spec.thread_id,
            "session_id": session.session_id if session else None,
            "channel_id": self.spec.channel_id,
            "started_at": self._started_at.isoformat(),
            "duration_ms": round(self._now_ms(), 1),
            "caller_turns": self.caller_turns,
            "agent_turns": len(self.detector.completed_turns),
            "turns": [turn_record(i, t, _turn_kind(i, t, greets)) for i, t in enumerate(turns)],
            "latencies_ms": [round(v, 1) for v in self.detector.latencies_ms()],
            "close_code": session.close_code if session else None,
            "close_reason": session.close_reason if session else None,
            "usage_seconds": self.closed.usage_seconds if self.closed else None,
            "final_usage_confirmed": self.closed.final_usage_confirmed if self.closed else None,
            "warnings": self.warnings,
            "event_counts": dict(Counter(e["type"] for e in self.events)),
        }


def _agent_row(text: str, last: AgentTurn, first: AgentTurn) -> dict[str, Any]:
    return {
        "role": "agent",
        "text": text,
        "start_ms": rounded(first.first_audio_ms),
        "end_ms": rounded(last.end_ms),
        "playback_end_ms": rounded(last.playback_end_ms),
        "latency_ms": rounded(first.latency_ms),
    }


def _turn_kind(index: int, turn: AgentTurn, agent_greets: bool) -> str:
    if turn.caller_end_ms is not None:
        return "reply"
    return "greeting" if index == 0 and agent_greets else "unprompted"
