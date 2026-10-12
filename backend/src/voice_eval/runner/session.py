"""Session runner: one conversation between the policy-driven caller and the agent under test.

The agent's own transcript (legacy `response.output_audio_transcript.done`, Live captions) is what
the policy hears; its decision is spoken with the TTS provider over the open-microphone caller
stream, streamed: synthesis starts when the policy decides, and the caller speaks from the first
synthesized chunk (`runner.speech`). Turn-taking is playback-aware: the caller speaks, and hangs up,
only once the agent's last reply would have finished playing. A response with no audio and no
transcript is no agent turn: the runner keeps waiting for the real reply. Right before the caller
speaks it checks again: if the agent started speaking since the policy decided, the caller waits for
it to finish and the policy decides again on the new text. The run ends when the caller hangs up,
the agent ends the session, or an end condition (max duration, max silence) is reached; it always
closes the session and writes its artifacts.

A scenario may make the caller barge in (legacy realtime only; see `runner.barge_in`): once
`after_ms` of agent turn N has played, the runner cuts the simulated playback, reports
`playback.interrupted` for every audio item still playing, drops the rest of that reply (it never
reaches live listeners nor `agent.wav`), and the policy decides on only the part of the agent's
text that was heard; the caller then speaks without waiting for the cut reply to play. The heard
text is an estimate (the played share of the audio applied to the text). The agent's server
confirms each report by relaying `conversation.item.truncated` (or `.deleted` for an item that
had not started): the runner correlates those by item id, until the run ends, and records them
per interruption (`confirmation`, per-item detail) and on the interrupted transcript row.

With a realtime caller (`realtime`, the scenario's realtime evaluator) no policy or TTS is used:
a speech-to-speech model hears the agent's audio as it arrives (`runner.realtime`) and, at the
same playback-aware moment the pipeline caller would speak, answers by voice; its audio streams
to the agent from the first chunk and its output transcript is the caller's transcript row. It
ends the call with its `hang_up` tool (after its goodbye played); a hang-up without any spoken
audio is refused once, and the caller asked at once to say its goodbye out loud (a second silent
hang-up ends the call anyway). On an interrupted turn it hears
only the audio that played before the cut, plus a note that it cut the agent off.
"""

import asyncio
import logging
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from websockets.exceptions import ConnectionClosed, WebSocketException

from voice_eval.audio import BYTES_PER_MS
from voice_eval.caller_stream import CallerAudioStream
from voice_eval.evaluator.prompt import (
    REALTIME_JUST_INTERRUPTED,
    REALTIME_OPENING,
    realtime_instructions,
)
from voice_eval.ports.policy import (
    CallerBrief,
    CallerDecision,
    CallerPolicy,
    PolicyState,
    Utterance,
)
from voice_eval.ports.realtime_caller import RealtimeCaller, RealtimeCallerError
from voice_eval.ports.target import (
    AgentBusy,
    AudioDelta,
    Closed,
    ItemDeleted,
    ItemTruncated,
    Ready,
    ResponseDone,
    ResponseStarted,
    ServerError,
    ServerEvent,
    TargetSession,
    TranscriptMessage,
    TranscriptUpdate,
)
from voice_eval.ports.tts import SpeechSynthesizer
from voice_eval.runner.artifacts import write_artifacts
from voice_eval.runner.barge_in import (
    AudioItem,
    Cut,
    Interruption,
    ItemCut,
    heard_text,
    playback_cuts,
    played_ms,
    position_bytes,
)
from voice_eval.runner.common import close_session, make_detector, rounded, turn_record
from voice_eval.runner.events import EventSink, RunEvent
from voice_eval.runner.realtime import AgentAudioFeed, RealtimeSpeech
from voice_eval.runner.speech import CallerSpeech
from voice_eval.targets.detect import ProtocolDetectionError, TargetSpec, open_target
from voice_eval.turns import AgentTurn, AgentTurnDetector

log = logging.getLogger(__name__)

POLL_S = 0.05
REALTIME_REASON = "realtime"  # the caller rows' reason: the realtime model gives none
HUNG_UP_OUTPUT = "the call has ended"
HANG_UP_REFUSED_OUTPUT = "the call cannot end yet: keep talking"
SAY_GOODBYE_OUTPUT = "the call has not ended: say a short goodbye out loud first, then hang up"


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
    sink_drain_timeout_s: float = 10  # then the artifacts are written without the sink
    interruptions: tuple[Interruption, ...] = ()  # the caller barges in on these agent turns


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
        self._ignored: set[str] = set()

    def ignore(self, message_ids: set[str]) -> None:
        """Never report these messages again (the rest of a reply the caller cut off)."""
        self._ignored |= message_ids

    def take(self, messages: list[TranscriptMessage]) -> str:
        parts = []
        for message in messages:
            if message.role != "assistant" or message.message_id in self._ignored:
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
    policy: CallerPolicy | None  # the pipeline evaluator (None with a realtime caller)
    synthesizer: SpeechSynthesizer | None
    sink: EventSink
    out_dir: Path
    options: SessionOptions = field(default_factory=SessionOptions)
    realtime: RealtimeCaller | None = None  # the realtime evaluator, instead of policy + TTS
    realtime_model: str | None = None  # the realtime evaluator's model, for the summary

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
        self.error: str | None = None  # why a failed run failed (no secret, no payload)
        self.closed: Closed | None = None
        self._ready = asyncio.Event()
        self._queue: asyncio.Queue[RunEvent | None] = asyncio.Queue()
        self._text = AgentTextTracker()
        self._reported_turns = 0
        self._last_activity_ms = 0.0
        self._agent_chunks = 0
        self._caller_chunks = 0
        self._caller_speaking = False  # between the first and the last speech frame of a turn
        self._decisions = 0  # ids of the policy's decisions, from 1
        self._speeches: list[CallerSpeech] = []  # decisions' words still being synthesized
        self._t0 = time.monotonic()
        self._started_at = datetime.now(UTC)
        self._reader: asyncio.Task[None] | None = None
        self._sender: asyncio.Task[None] | None = None
        self._plans = {plan.agent_turn: plan for plan in self.options.interruptions}
        self._agent_turns = 0  # agent turns reported to the policy
        self._items: dict[int, list[AudioItem]] = {}  # id(agent turn) -> its audio items
        self._cut_items: set[str] = set()
        self._cut_responses: set[str] = set()
        self.interruptions: list[dict[str, Any]] = []
        # item id -> (agent turn, its report record) for every item reported as interrupted
        self._reported: dict[str, tuple[int, dict[str, Any]]] = {}
        self._confirmed_at: dict[str, float] = {}  # item id -> run time of its confirmation
        # agent turn -> its interruption record and transcript row (None: no row), kept current
        self._interrupted: dict[int, tuple[dict[str, Any], dict[str, Any] | None]] = {}
        self._feed: AgentAudioFeed | None = None
        self._cuts_noted = 0  # interruptions the realtime caller was told about

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
            await self._drain(dispatcher)
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

    async def _drain(self, dispatcher: "asyncio.Task[None]") -> None:
        """Let the sink take the remaining events, but never wait for it forever."""
        try:
            await asyncio.wait_for(asyncio.shield(dispatcher), self.options.sink_drain_timeout_s)
        except TimeoutError:
            dispatcher.cancel()
            message = "the event sink did not take every event in time"
            log.warning(message)
            self.warnings.append(message)

    def _finish(self, status: str, reason: str, message: str | None = None) -> None:
        if self.status is not None:
            return
        self.status, self.reason = status, reason
        if message:
            self._warn(message)
            if status == "failed":
                self.error = message

    async def _converse(self) -> None:
        if self.realtime is not None:
            await self._open_realtime(self.realtime)
        try:
            self.session = await open_target(self.spec, self.options.ready_timeout_s)
        except ProtocolDetectionError as exc:
            raise Stop("failed", "protocol_error", str(exc)) from None
        except (OSError, TimeoutError, WebSocketException) as exc:
            raise Stop(
                "failed", "connect_failed", f"could not connect ({type(exc).__name__})"
            ) from None
        if self._plans and not self.session.supports_playback_interruption:
            self._plans = {}
            self._warn(
                f"interruptions are not supported on the {self.session.protocol} protocol; "
                "the caller will not interrupt the agent"
            )
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
                if self.realtime is not None:
                    await self._realtime_loop(self.session, self.realtime)
                else:
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
                    if await self._agent_spoke_again():
                        self._discard(decision)
                        continue
                    raise Stop("completed", "caller_hung_up")
                await self._agent_turn()  # nothing to say: listen
                continue
            speech = self._synthesize(decision.say)
            try:
                if await self._agent_spoke_again() or not await self._first_audio(speech):
                    self._discard(decision)
                    continue
                said = self._speak(decision, speech)
            finally:
                if not speech.attached:
                    await self._drop(speech)
            if decision.hang_up:
                await self._wait_until(said.is_set)
                raise Stop("completed", "caller_hung_up")
            await self._agent_turn()

    async def _shutdown(self) -> None:
        """Stop the caller stream and close the session, whatever state the sender ended in."""
        for speech in list(self._speeches):
            await self._drop(speech)
        if self._feed is not None:
            await self._feed.stop()
        if self.realtime is not None:
            try:
                await self.realtime.close()
            except Exception as exc:
                log.warning("realtime caller close failed (%s)", type(exc).__name__)
        if self._sender is not None:
            self._sender.cancel()
            try:
                await self._sender
            except (asyncio.CancelledError, ConnectionClosed):
                pass
            except Exception as exc:  # already reported by `_wait_until`; still close below
                log.warning("caller audio sender failed (%s)", type(exc).__name__)
        if self.session is None:
            return
        if self._reader is None:
            self._reader = asyncio.create_task(self._read())
        for warning in await close_session(
            self.session, self._reader, timeout_s=self.options.close_timeout_s
        ):
            self._warn(warning)
        self.detector.turn_ended(self._now_ms())

    # --- realtime evaluator -----------------------------------------------------------------

    async def _open_realtime(self, caller: RealtimeCaller) -> None:
        try:
            await caller.open(realtime_instructions(self.brief))
        except RealtimeCallerError as exc:
            raise Stop("failed", "realtime_failed", f"realtime caller failed ({exc})") from None
        except Exception as exc:  # never a provider payload: the type only
            raise Stop(
                "failed", "realtime_failed", f"realtime caller failed ({type(exc).__name__})"
            ) from None
        self._feed = AgentAudioFeed(caller)
        self._feed.start()

    async def _realtime_loop(self, session: TargetSession, caller: RealtimeCaller) -> None:
        if session.agent_speaks_first:
            await self._agent_turn()
        while True:
            if await self._agent_spoke_again():
                continue
            if await self._realtime_turn(caller):
                await self._agent_turn()

    async def _realtime_turn(self, caller: RealtimeCaller, *, goodbye_asked: bool = False) -> bool:
        """One caller response; False when the agent started speaking before its first audio
        (the response is cancelled and the agent's turn collected). Raises `Stop` on hang-up."""
        speech = await self._realtime_response(caller, noted=not goodbye_asked)
        said: asyncio.Event | None = None
        row: dict[str, Any] | None = None
        try:
            await self._wait_until(lambda: speech.has_audio or speech.done or self._agent_active())
            self._check_speech()
            if not speech.has_audio and not speech.done:  # the agent spoke first
                await self._drop(speech)
                self._publish(
                    "caller_decision_discarded",
                    self._realtime_decision(speech, say=None, hang_up=False),
                )
                await self._agent_spoke_again()
                return False
            if speech.has_audio:
                said, row = self._utter(speech, speech.decision_id, "", REALTIME_REASON)
            await self._wait_until(lambda: speech.done)  # its transcript and hang-up
            self._check_speech()
        finally:
            if not speech.attached:
                await self._drop(speech)
        self._realtime_decided(speech, row)
        if goodbye_asked and speech.hang_up is None and self.options.hang_up_when != "max_duration":
            # The caller ends the call (the agent never does): the goodbye it was asked for closes
            # the call even when the model forgets the tool, so goodbyes cannot ping-pong.
            if said is not None:
                await self._wait_until(said.is_set)
            raise Stop("completed", "caller_hung_up")
        if speech.hang_up is not None:
            if self.options.hang_up_when == "max_duration":
                self._warn("the caller tried to hang up; this scenario ends only at max duration")
                await self._answer_tool(caller, speech.hang_up.call_id, HANG_UP_REFUSED_OUTPUT)
            elif not speech.has_audio and not goodbye_asked:
                self._warn("the caller hung up without a word; it was asked to say goodbye first")
                await self._answer_tool(caller, speech.hang_up.call_id, SAY_GOODBYE_OUTPUT)
                return await self._realtime_turn(caller, goodbye_asked=True)
            else:
                if said is not None:
                    await self._wait_until(said.is_set)
                await self._answer_tool(caller, speech.hang_up.call_id, HUNG_UP_OUTPUT)
                raise Stop("completed", "caller_hung_up")
        return True

    async def _realtime_response(
        self, caller: RealtimeCaller, *, noted: bool = True
    ) -> RealtimeSpeech:
        """Start the caller's response once it heard everything the agent said so far; `noted`
        False sends no opening or interruption note (a retry of the same turn)."""
        assert self._feed is not None
        feed = self._feed
        await self._wait_until(lambda: feed.idle)
        note = None
        if not noted:
            pass
        elif self._agent_turns == 0 and self.caller_turns == 0:
            note = REALTIME_OPENING
        elif len(self.interruptions) > self._cuts_noted:
            self._cuts_noted = len(self.interruptions)
            note = REALTIME_JUST_INTERRUPTED
        self._decisions += 1
        self._speeches = [s for s in self._speeches if not s.done or s.failure is not None]
        speech = RealtimeSpeech(
            caller,
            note,
            decision_id=self._decisions,
            timeout_s=self.options.tts_timeout_s,
            now_ms=self._now_ms,
        )
        self._speeches.append(speech)
        return speech

    def _realtime_decision(
        self, speech: RealtimeSpeech, *, say: str | None, hang_up: bool
    ) -> dict[str, Any]:
        return {
            "decision_id": speech.decision_id,
            "say": say,
            "hang_up": hang_up,
            "reason": REALTIME_REASON,
        }

    def _realtime_decided(self, speech: RealtimeSpeech, row: dict[str, Any] | None) -> None:
        """The response is done: its words go to the transcript and the conversation."""
        text = (speech.transcript or "").strip()
        if row is not None:
            row["text"] = text
            self.conversation.append(Utterance("caller", text))
            if not text:
                self._warn("the realtime caller's speech had no transcript")
        data = self._realtime_decision(speech, say=text or None, hang_up=speech.hang_up is not None)
        data["started_ms"] = rounded(speech.started_ms)
        # the realtime "decision" is the time to its first audio (the whole response if none)
        data["duration_ms"] = rounded(
            speech.first_chunk_ms if speech.first_chunk_ms is not None else speech.total_ms
        )
        self._publish("caller_decision", data)

    async def _answer_tool(self, caller: RealtimeCaller, call_id: str, output: str) -> None:
        try:
            await caller.tool_output(call_id, output)
        except Exception as exc:  # the call goes on (or ends) either way
            self._warn(f"could not answer the realtime caller's tool call ({type(exc).__name__})")

    # --- turns ----------------------------------------------------------------------------

    async def _decide(self) -> CallerDecision:
        assert self.policy is not None
        state = PolicyState(
            brief=self.brief,
            conversation=tuple(self.conversation),
            elapsed_s=self._now_ms() / 1000,
            caller_turns=self.caller_turns,
        )
        started_ms = self._now_ms()
        try:
            decision = await self.policy.next_turn(state)
        except Exception as exc:
            raise Stop(
                "failed", "evaluator_failed", f"evaluator failed ({type(exc).__name__})"
            ) from None
        self._decisions += 1
        data = self._decision_data(decision)
        data["started_ms"] = rounded(started_ms)
        data["duration_ms"] = rounded(self._now_ms() - started_ms)
        self._publish("caller_decision", data)
        return decision

    def _decision_data(self, decision: CallerDecision) -> dict[str, Any]:
        return {
            "decision_id": self._decisions,
            "say": decision.say,
            "hang_up": decision.hang_up,
            "reason": decision.reason,
        }

    def _synthesize(self, text: str) -> CallerSpeech:
        """Start streaming the decision's words; a failure stops the run where it is noticed."""
        decision_id = self._decisions

        def synthesized(speech: CallerSpeech) -> None:
            self._publish(
                "caller_speech_synthesized",
                {
                    "decision_id": decision_id,
                    "tts_first_chunk_ms": rounded(speech.first_chunk_ms),
                    "tts_total_ms": rounded(speech.total_ms),
                },
            )

        assert self.synthesizer is not None
        self._speeches = [s for s in self._speeches if not s.done or s.failure is not None]
        speech = CallerSpeech(
            self.synthesizer,
            text,
            timeout_s=self.options.tts_timeout_s,
            now_ms=self._now_ms,
            on_done=synthesized,
        )
        self._speeches.append(speech)
        return speech

    async def _first_audio(self, speech: CallerSpeech) -> bool:
        """Hold until the first synthesized chunk; False if the agent started speaking first.

        The agent's new turn is collected (it ends and plays) before returning False, so the
        policy decides again on it.
        """
        await self._wait_until(lambda: speech.has_audio or speech.done or self._agent_active())
        self._check_speech()
        if speech.has_audio:
            return True
        await self._drop(speech)
        await self._agent_spoke_again()
        return False

    async def _drop(self, speech: CallerSpeech) -> None:
        await speech.cancel()
        if speech in self._speeches:
            self._speeches.remove(speech)

    def _check_speech(self) -> None:
        """A failed synthesis stops the run, also when it broke off mid-utterance."""
        for speech in self._speeches:
            if speech.failure is not None:
                raise Stop("failed", speech.failure_reason, speech.failure)

    def _speak(self, decision: CallerDecision, speech: CallerSpeech) -> asyncio.Event:
        """Queue the caller's words as they are synthesized; the event is set after the last."""
        assert decision.say is not None
        said, _ = self._utter(speech, self._decisions, decision.say, decision.reason)
        self.conversation.append(Utterance("caller", decision.say))
        return said

    def _utter(
        self, speech: CallerSpeech, decision_id: int, say: str, reason: str
    ) -> tuple[asyncio.Event, dict[str, Any]]:
        """Speak `speech` as the caller's next turn: its transcript row and a `said` event."""
        assert self.stream is not None
        said = asyncio.Event()
        row: dict[str, Any] = {
            "role": "caller",
            "text": say,
            "start_ms": None,
            "end_ms": None,
            "reason": reason,
        }
        completed = self.detector.completed_turns
        previous = completed[-1] if completed else None

        def started(now_ms: float) -> None:
            self._caller_speaking = True
            self._publish(
                "caller_speaking",
                {
                    "decision_id": decision_id,
                    "say": say,
                    "reason": reason,
                    "tts_first_chunk_ms": rounded(speech.first_chunk_ms),
                },
            )
            row["start_ms"] = rounded(now_ms)
            if previous is not None and previous.caller_resumed_ms is None:
                previous.caller_resumed_ms = now_ms

        def ended(now_ms: float) -> None:
            self._caller_speaking = False
            row["end_ms"] = rounded(now_ms)
            self.detector.mark_caller_end(now_ms)
            said.set()

        self.transcript.append(row)
        self.caller_turns += 1
        speech.attach(self.stream.open(self.options.trailing_silence_ms, ended, started))
        return said, row

    async def _agent_turn(self) -> None:
        """Wait for the agent's next real turn, skipping empty responses (max silence bounds it)."""
        while not await self._collect_agent_turn():
            pass

    async def _collect_agent_turn(self) -> bool:
        """Wait for the agent's next turn (and any turn it chains) to end; report what it said.

        False when it said nothing at all (a response with no audio and no transcript, e.g. a
        cancelled or tool-only one): those turns are dropped, so the evaluator never hears them
        and they never count as agent turns. When the scenario interrupts this turn and its
        audio is longer than the interruption point, the turn ends at that point of playback.
        """
        plan = self._plans.get(self._agent_turns + 1)
        due: list[AgentTurn] = []
        await self._wait_until(lambda: self._turn_over(plan, due), check_silence=True)
        assert self.session is not None
        cut = await self._cut(plan, due[0]) if plan is not None and due else None
        if self._feed is not None:  # the realtime caller hears only what played
            self._feed.release(position_bytes(cut.audio_end_ms) if cut is not None else None)
        text = self._text.take(self.session.transcript_messages())
        if cut is not None:
            self._text.ignore(cut.item_ids)
        new_turns = self.detector.completed_turns[self._reported_turns :]
        silent = [turn for turn in new_turns if not turn.audio_bytes]
        if silent and (not text or len(silent) < len(new_turns)):
            for turn in silent:
                self.detector.discard(turn)
            new_turns = [turn for turn in new_turns if turn.audio_bytes]
        self._reported_turns = len(self.detector.completed_turns)
        if not new_turns:
            self._warn("the agent response had no audio and no transcript; waiting for its reply")
            return False
        self._agent_turns += 1
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
        last = new_turns[-1]
        row = _agent_row(text, last, new_turns[0])
        data: dict[str, Any] = {"turn": self._reported_turns - 1, "text": text}
        if cut is None:
            heard = text
        else:
            heard = heard_text(text, cut.fraction)
            marks = {
                "interrupted": True,
                "heard_text": heard,
                "heard_text_estimated": True,
                "audio_end_ms": cut.audio_end_ms,
            }
            row.update(marks)
            data.update(marks)
            self._record_interruption(
                cut, heard, text, row
            )  # also when the reply had no transcript
            data["interruption_confirmed"] = row["interruption_confirmed"]
        if not text:
            self._warn("the agent turn had no transcript")
            if cut is None:
                return True
        # An interrupted turn: the policy hears only what played before the caller cut in.
        self.conversation.append(Utterance("agent", heard, interrupted=cut is not None))
        self.transcript.append(row)
        self._publish("agent_transcript", data)
        return True

    def _next_audio_turn(self) -> AgentTurn | None:
        """The first unreported agent turn that has audio (still open or already completed)."""
        turns = self.detector.completed_turns[self._reported_turns :]
        if self.detector.current_turn is not None:
            turns = [*turns, self.detector.current_turn]
        return next((t for t in turns if t.audio_bytes and t.first_audio_ms is not None), None)

    def _turn_over(self, plan: Interruption | None, due: list[AgentTurn]) -> bool:
        """Whether to stop waiting for the agent: its turn ended, or it is time to cut it off.

        A turn whose audio is longer than the interruption point is cut once that point has
        played, even when it already ended (its audio arrives faster than it plays); `due` then
        receives it.
        """
        if plan is not None:
            turn = self._next_audio_turn()
            if turn is not None and turn.audio_bytes / BYTES_PER_MS > plan.after_ms:
                assert turn.first_audio_ms is not None
                if self._now_ms() - turn.first_audio_ms < plan.after_ms:
                    return False
                due.append(turn)
                return True
        return (
            len(self.detector.completed_turns) > self._reported_turns
            and not self.detector.agent_speaking
        )

    async def _cut(self, plan: Interruption, turn: AgentTurn) -> Cut:
        """Cut `turn`'s playback now: drop the rest of it and report it to the agent."""
        assert self.session is not None and turn.first_audio_ms is not None
        now = self._now_ms()
        received_ms = turn.audio_bytes / BYTES_PER_MS
        position = min(now - turn.first_audio_ms, received_ms)
        items = self._items.get(id(turn), [])
        cuts = playback_cuts(items, position)
        if not cuts and items:  # all received audio played (the stream lagged): stop the last
            last = items[-1]
            cuts = [ItemCut(last.item_id, last.response_id, played_ms(last.audio_bytes))]
        # Before any await: from now on the reader drops whatever else arrives for this reply.
        self._cut_items |= {item.item_id for item in items}
        self._cut_responses |= {item.response_id for item in items if item.response_id}
        self.detector.interrupt(turn, turn.first_audio_ms + position)
        reported: list[ItemCut] = []
        for item in cuts:
            if item.response_id is None:
                self._warn(f"agent audio item {item.item_id} has no response id: not reported")
                continue
            # Expect the confirmation before sending: the reader may get it during the await.
            self._expect_confirmation(plan.agent_turn, item)
            try:
                await self.session.send_playback_interrupted(
                    item.item_id, item.response_id, item.audio_end_ms
                )
            except (ConnectionClosed, WebSocketException) as exc:
                self._reported.pop(item.item_id, None)
                self._warn(f"could not report the interruption ({type(exc).__name__})")
                break
            reported.append(item)
        return Cut(
            agent_turn=plan.agent_turn,
            audio_end_ms=played_ms(position_bytes(position)),
            fraction=position / received_ms if received_ms else 0.0,
            item_ids={item.item_id for item in items},
            reported=tuple(reported),
        )

    def _expect_confirmation(self, agent_turn: int, item: ItemCut) -> None:
        self._reported[item.item_id] = (
            agent_turn,
            {
                "item_id": item.item_id,
                "sent_audio_end_ms": item.audio_end_ms,
                "confirmation": None,
                "confirmed_audio_end_ms": None,
            },
        )

    def _on_confirmation(self, item_id: str, kind: str, audio_end_ms: int | None) -> None:
        """The agent's server applied a reported interruption to one item (first word counts)."""
        reported = self._reported.get(item_id)
        if reported is None or reported[1]["confirmation"] is not None:
            return  # not an item the caller cut off, or already confirmed
        agent_turn, item = reported
        item["confirmation"], item["confirmed_audio_end_ms"] = kind, audio_end_ms
        self._publish(
            "interruption_confirmed",
            {
                "agent_turn": agent_turn,
                "item_id": item_id,
                "kind": kind,
                "audio_end_ms": audio_end_ms,
            },
        )
        self._confirmed_at[item_id] = self.events[-1]["t_ms"]
        if (views := self._interrupted.get(agent_turn)) is not None:
            self._refresh_confirmation(*views)

    def _refresh_confirmation(self, record: dict[str, Any], row: dict[str, Any] | None) -> None:
        """Confirmed only once every reported item is: `truncated` when any item was truncated
        (its position is `confirmed_audio_end_ms`), `deleted` when all were deleted."""
        items = record["items"]
        confirmation = confirmed_end = confirmed_at = None
        if items and all(item["confirmation"] for item in items):
            truncated = [item for item in items if item["confirmation"] == "truncated"]
            confirmation = "truncated" if truncated else "deleted"
            confirmed_end = truncated[0]["confirmed_audio_end_ms"] if truncated else None
            confirmed_at = max(self._confirmed_at[item["item_id"]] for item in items)
        record["confirmation"] = confirmation
        record["confirmed_audio_end_ms"] = confirmed_end
        record["confirmed_at_ms"] = confirmed_at
        if row is not None:
            row["interruption_confirmed"] = confirmation is not None

    def _record_interruption(
        self, cut: Cut, heard: str, text: str, row: dict[str, Any] | None
    ) -> None:
        record: dict[str, Any] = {
            "agent_turn": cut.agent_turn,
            "audio_end_ms": cut.audio_end_ms,
            "heard_chars": len(heard),
            "total_chars": len(text),
            "items": [self._reported[item.item_id][1] for item in cut.reported],
        }
        self._interrupted[cut.agent_turn] = (record, row)
        self._refresh_confirmation(record, row)
        self.interruptions.append(record)
        self._publish(
            "caller_interrupted",
            {"agent_turn": cut.agent_turn, "audio_end_ms": cut.audio_end_ms, "heard_text": heard},
        )

    async def _agent_spoke_again(self) -> bool:
        """Hold until the agent is quiet and its audio has played; True if it said more meanwhile.

        The policy decided on the conversation as it was. If the agent started another response
        since (its real reply after an empty one, or a follow-up), speaking now would barge in
        on it: the caller waits for it to end and play, and the decision is stale.
        """
        while True:
            await self._wait_playback()
            if not self._agent_active():
                return False
            if await self._collect_agent_turn():
                return True

    def _agent_active(self) -> bool:
        self.detector.turn_ended(self._now_ms())
        detector = self.detector
        return detector.agent_speaking or len(detector.completed_turns) > self._reported_turns

    def _discard(self, decision: CallerDecision) -> None:
        self._publish("caller_decision_discarded", self._decision_data(decision))

    async def _wait_playback(self) -> None:
        """Hold until every agent turn would have finished playing (plus a short grace)."""
        ends = [t.playback_end_ms for t in self.detector.completed_turns]
        playback_end = max((end for end in ends if end is not None), default=None)
        if playback_end is None:
            return
        target_ms = playback_end + self.options.playback_grace_ms
        await self._wait_until(lambda: self._now_ms() >= target_ms)

    async def _wait_until(self, done: Any, *, check_silence: bool = False) -> None:
        while True:
            self.detector.turn_ended(self._now_ms())
            if done():
                return
            self._check_speech()
            if self._feed is not None and self._feed.failure is not None:
                raise Stop("failed", "realtime_failed", self._feed.failure)
            if (exc := self._sender_failure()) is not None:
                raise Stop(
                    "failed",
                    "caller_audio_failed",
                    f"sending caller audio failed ({type(exc).__name__})",
                )
            if self._reader is not None and self._reader.done():
                if self.closed is not None:
                    raise Stop("completed", "agent_ended")
                raise Stop("failed", "connection_closed", "the agent connection closed")
            if check_silence and self._silent_for_ms() >= self.options.max_silence_s * 1000:
                raise Stop("completed", "max_silence")
            await asyncio.sleep(POLL_S)

    def _sender_failure(self) -> BaseException | None:
        """The error that stopped the caller stream (a closed socket is the reader's to report)."""
        sender = self._sender
        if sender is None or not sender.done() or sender.cancelled():
            return None
        exc = sender.exception()
        return None if isinstance(exc, ConnectionClosed) else exc

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
            case AudioDelta(pcm=pcm, item_id=item_id, response_id=response_id):
                if item_id in self._cut_items or response_id in self._cut_responses:
                    return  # the rest of a reply the caller cut off: never played
                self.agent_pcm += pcm
                if self._feed is not None:  # a turn the caller will cut is held until the cut
                    self._feed.push(pcm, hold=self._agent_turns + 1 in self._plans)
                opening = self.detector.current_turn is None
                self.detector.on_agent_audio(t, len(pcm))
                if opening:
                    self._on_agent_turn_opened()
                if item_id is not None:
                    self._track_item(item_id, response_id, len(pcm))
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
            case ResponseStarted(response_id=response_id) if response_id in self._cut_responses:
                pass
            case ResponseDone(response_id=response_id) if response_id in self._cut_responses:
                pass  # the end of a reply the caller cut off: its turn is already over
            case ResponseStarted():
                opening = self.detector.current_turn is None
                self.detector.on_response_started(t)
                if opening:
                    self._on_agent_turn_opened()
                self._last_activity_ms = t
            case ResponseDone():
                self.detector.on_response_done(t)
                self._last_activity_ms = t
            case AgentBusy():
                self.detector.on_busy(t)
                self._last_activity_ms = t
            case ItemTruncated(item_id=item_id, audio_end_ms=audio_end_ms):
                self._on_confirmation(item_id, "truncated", audio_end_ms)
            case ItemDeleted(item_id=item_id):
                self._on_confirmation(item_id, "deleted", None)
            case ServerError(message=message):
                self._warn(f"server error: {message}")
            case Closed():
                self.closed = event

    def _track_item(self, item_id: str, response_id: str | None, nbytes: int) -> None:
        """Count the audio of each conversation item of the open agent turn, in arrival order."""
        turn = self.detector.current_turn
        if turn is None:
            return
        items = self._items.setdefault(id(turn), [])
        item = next((i for i in reversed(items) if i.item_id == item_id), None)
        if item is None:
            item = AudioItem(item_id, response_id)
            items.append(item)
        item.audio_bytes += nbytes

    def _on_agent_turn_opened(self) -> None:
        """The agent starting while the caller is mid-utterance barges in: record it.

        The caller's utterance is not cut; the target decides what its own VAD does with it.
        """
        if self._caller_speaking:
            self._publish("agent_barge_in", {"caller_turn": self.caller_turns})

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
            "error": self.error,
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
            "interruptions": self.interruptions,
            "evaluator_mode": "pipeline" if self.realtime is None else "realtime",
            "realtime_model": None if self.realtime is None else self.realtime_model,
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
