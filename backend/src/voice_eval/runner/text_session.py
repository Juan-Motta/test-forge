"""Text session runner: one chat between the policy-driven user and a text agent.

The user always writes first (a text agent never speaks unprompted). Each turn the policy decides
(`say` and/or `hang_up`), the message goes to the agent on the run's thread (the same UUID
`thread_id` every turn continues the conversation), and the reply is consumed as it streams:
every text piece is published live (`agent_text_delta`), as are the agent's tools
(`agent_tool_started`, `agent_tool_ended`). A farewell (`say` with `hang_up`) is still sent and
answered before the chat ends.

The chat ends when the user ends it (`caller_hung_up`), after `max_turns` messages of the user
(`max_turns`), at `max_duration_s` of wall-clock time (`max_duration`), or when the user has
nothing to say `MAX_SILENT_DECISIONS` times in a row (`caller_silent`, only possible when the
scenario forbids hanging up). A reply the agent could not finish (`TextTargetError`, e.g. a
stream without its final event) fails the run (`agent_error`); its partial text is kept on an
`incomplete` transcript row. The runner always writes its artifacts: `transcript.json`,
`events.jsonl` and `summary.json` (no audio).

Events reuse the voice names where the meaning holds, so live monitors keep working:
`run_started`, `protocol_detected` (the chat is open), `caller_decision`, `caller_speaking` (the
message was sent), `agent_text_delta`, `agent_tool_started`, `agent_tool_ended`,
`agent_transcript` (the whole reply), `turn_ended`, `warning`, `run_finished`.
"""

import asyncio
import json
import logging
import time
from collections import Counter
from contextlib import aclosing
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from voice_eval.evaluator.prompt import ChatPolicyState
from voice_eval.ports.policy import CallerBrief, CallerDecision, CallerPolicy, Utterance
from voice_eval.ports.text_target import (
    ReplyEnded,
    TextDelta,
    TextTarget,
    TextTargetError,
    ToolEnded,
    ToolStarted,
)
from voice_eval.runner.artifacts import write_json
from voice_eval.runner.common import rounded
from voice_eval.runner.events import EventSink, RunEvent
from voice_eval.runner.session import Stop

log = logging.getLogger(__name__)

PROTOCOL = "http_chat"
MAX_SILENT_DECISIONS = 3
DEFAULT_MAX_TURNS = 20


@dataclass
class TextSessionOptions:
    """End conditions (from the scenario)."""

    max_turns: int = DEFAULT_MAX_TURNS
    max_duration_s: float = 360
    hang_up_when: str = "goal_or_goodbye"
    sink_drain_timeout_s: float = 10  # then the artifacts are written without the sink


@dataclass
class TextSessionRunner:
    target: TextTarget
    thread_id: str
    brief: CallerBrief
    policy: CallerPolicy
    sink: EventSink
    out_dir: Path
    options: TextSessionOptions = field(default_factory=TextSessionOptions)
    channel_id: str | None = None
    text_mode: str = "stream"
    notices: tuple[str, ...] = ()  # warnings to record at the start (e.g. ignored settings)

    def __post_init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self.conversation: list[Utterance] = []
        self.transcript: list[dict[str, Any]] = []
        self.turns: list[dict[str, Any]] = []
        self.warnings: list[str] = []
        self.caller_turns = 0
        self.status: str | None = None
        self.reason: str | None = None
        self.error: str | None = None
        self._decisions = 0
        self._queue: asyncio.Queue[RunEvent | None] = asyncio.Queue()
        self._t0 = time.monotonic()
        self._started_at = datetime.now(UTC)

    def _now_ms(self) -> float:
        return (time.monotonic() - self._t0) * 1000

    # --- events ---------------------------------------------------------------------------

    def _publish(self, kind: str, data: dict[str, Any]) -> None:
        event = RunEvent(kind, round(self._now_ms(), 1), data)
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

    async def _drain(self, dispatcher: "asyncio.Task[None]") -> None:
        try:
            await asyncio.wait_for(asyncio.shield(dispatcher), self.options.sink_drain_timeout_s)
        except TimeoutError:
            dispatcher.cancel()
            message = "the event sink did not take every event in time"
            log.warning(message)
            self.warnings.append(message)

    # --- lifecycle ------------------------------------------------------------------------

    async def run(self) -> dict[str, Any]:
        """Hold the chat; return the summary (also written to `summary.json`)."""
        self._t0 = time.monotonic()
        self._started_at = datetime.now(UTC)
        dispatcher = asyncio.create_task(self._dispatch())
        self._publish(
            "run_started",
            {
                "kind": "text",
                "thread_id": self.thread_id,
                "channel_id": self.channel_id,
                "text_mode": self.text_mode,
                "max_turns": self.options.max_turns,
                "max_duration_s": self.options.max_duration_s,
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
            except Exception as exc:  # a bug must still leave artifacts
                log.exception("text session runner failed")
                self._finish("failed", "internal_error", f"internal error ({type(exc).__name__})")
        finally:
            self._publish("run_finished", {"status": self.status, "reason": self.reason})
            self._queue.put_nowait(None)
            await self._drain(dispatcher)
            summary = self.summary()
            self._write(summary)
        return summary

    def _finish(self, status: str, reason: str, message: str | None = None) -> None:
        if self.status is not None:
            return
        self.status, self.reason = status, reason
        if message:
            self._warn(message)
            if status == "failed":
                self.error = message

    def _write(self, summary: dict[str, Any]) -> None:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        write_json(self.out_dir / "transcript.json", self.transcript)
        write_json(self.out_dir / "summary.json", summary)
        with (self.out_dir / "events.jsonl").open("w") as f:
            for record in self.events:
                f.write(_json_line(record))

    async def _converse(self) -> None:
        self._publish("protocol_detected", {"protocol": PROTOCOL, "text_mode": self.text_mode})
        for notice in self.notices:
            self._warn(notice)
        try:
            async with asyncio.timeout(self.options.max_duration_s) as deadline:
                await self._loop()
        except TimeoutError:
            if deadline.expired():
                raise Stop("completed", "max_duration") from None
            raise

    async def _loop(self) -> None:
        silent = 0
        while True:
            if self.caller_turns >= self.options.max_turns:
                raise Stop("completed", "max_turns")
            decision = await self._decide()
            if decision.hang_up and self.options.hang_up_when == "max_duration":
                self._warn("the user tried to end the chat; this scenario ends only at its limits")
                decision = CallerDecision(decision.say, False, decision.reason)
            if decision.say is None:
                if decision.hang_up:
                    raise Stop("completed", "caller_hung_up")
                silent += 1
                if silent >= MAX_SILENT_DECISIONS:
                    raise Stop("completed", "caller_silent")
                continue
            silent = 0
            await self._exchange(decision.say, decision.reason)
            if decision.hang_up:
                raise Stop("completed", "caller_hung_up")

    async def _decide(self) -> CallerDecision:
        state = ChatPolicyState(
            brief=self.brief,
            conversation=tuple(self.conversation),
            elapsed_s=self._now_ms() / 1000,
            caller_turns=self.caller_turns,
            max_turns=self.options.max_turns,
        )
        started_ms = self._now_ms()
        try:
            decision = await self.policy.next_turn(state)
        except Exception as exc:
            raise Stop(
                "failed", "evaluator_failed", f"evaluator failed ({type(exc).__name__})"
            ) from None
        self._decisions += 1
        self._publish(
            "caller_decision",
            {
                "decision_id": self._decisions,
                "say": decision.say,
                "hang_up": decision.hang_up,
                "reason": decision.reason,
                "started_ms": rounded(started_ms),
                "duration_ms": rounded(self._now_ms() - started_ms),
            },
        )
        return decision

    async def _exchange(self, say: str, reason: str) -> None:
        """Send the user's message and take the agent's whole reply."""
        turn = len(self.turns)
        request_ms = round(self._now_ms(), 1)
        self.transcript.append(
            {
                "role": "caller",
                "text": say,
                "start_ms": rounded(request_ms),
                "end_ms": rounded(request_ms),
                "reason": reason,
            }
        )
        self.conversation.append(Utterance("caller", say))
        self.caller_turns += 1
        self._publish(
            "caller_speaking", {"decision_id": self._decisions, "say": say, "reason": reason}
        )
        parts: list[str] = []
        tools: list[str] = []
        end: ReplyEnded | None = None
        try:
            async with aclosing(self.target.send(say, thread_id=self.thread_id)) as events:
                async for event in events:
                    if isinstance(event, TextDelta):
                        parts.append(event.text)
                        self._publish("agent_text_delta", {"turn": turn, "text": event.text})
                    elif isinstance(event, ToolStarted):
                        tools.append(event.name)
                        self._publish("agent_tool_started", {"turn": turn, "name": event.name})
                    elif isinstance(event, ToolEnded):
                        self._publish(
                            "agent_tool_ended",
                            {
                                "turn": turn,
                                "name": event.name,
                                "success": event.success,
                                "elapsed_ms": event.elapsed_ms,
                            },
                        )
                    elif isinstance(event, ReplyEnded):
                        end = event
                        break
            if end is None:
                raise TextTargetError("The agent's reply ended without a final event")
        except TextTargetError as exc:
            self._incomplete("".join(parts), tools, request_ms)
            raise Stop("failed", "agent_error", str(exc)) from None
        except (asyncio.CancelledError, TimeoutError):
            self._incomplete("".join(parts), tools, request_ms)
            raise
        self._replied(turn, end, tools, request_ms)

    def _replied(self, turn: int, end: ReplyEnded, tools: list[str], request_ms: float) -> None:
        latency = end.first_text_ms if end.first_text_ms is not None else end.total_ms
        first_ms = None if end.first_text_ms is None else request_ms + end.first_text_ms
        end_ms = request_ms + end.total_ms
        record = {
            "index": turn,
            "kind": "reply",
            "request_ms": rounded(request_ms),
            "first_text_ms": rounded(first_ms),
            "end_ms": rounded(end_ms),
            "latency_ms": rounded(float(latency)),
            "tools": list(tools),
        }
        self.turns.append(record)
        if not end.text.strip():
            self._warn("the agent reply had no text")
        row = {
            "role": "agent",
            "text": end.text,
            "start_ms": rounded(first_ms if first_ms is not None else end_ms),
            "end_ms": rounded(end_ms),
            "latency_ms": rounded(float(latency)),
            "first_text_ms": end.first_text_ms,
            "tools": list(tools),
        }
        self.transcript.append(row)
        self.conversation.append(Utterance("agent", end.text))
        self._publish(
            "agent_transcript",
            {
                "turn": turn,
                "text": end.text,
                "first_text_ms": end.first_text_ms,
                "latency_ms": row["latency_ms"],
                "tools": list(tools),
            },
        )
        self._publish(
            "turn_ended",
            {
                "turn": turn,
                "request_ms": record["request_ms"],
                "first_text_ms": record["first_text_ms"],
                "end_ms": record["end_ms"],
                "latency_ms": record["latency_ms"],
            },
        )

    def _incomplete(self, text: str, tools: list[str], request_ms: float) -> None:
        """Keep what arrived of a reply that never finished (never a measured turn)."""
        if not text and not tools:
            return
        now = rounded(self._now_ms())
        self.transcript.append(
            {
                "role": "agent",
                "text": text,
                "start_ms": rounded(request_ms),
                "end_ms": now,
                "latency_ms": None,
                "first_text_ms": None,
                "tools": list(tools),
                "incomplete": True,
            }
        )

    def summary(self) -> dict[str, Any]:
        return {
            "kind": "text",
            "status": self.status,
            "reason": self.reason,
            "error": self.error,
            "protocol": PROTOCOL,
            "text_mode": self.text_mode,
            "thread_id": self.thread_id,
            "langfuse_session_id": self.thread_id,
            "channel_id": self.channel_id,
            "started_at": self._started_at.isoformat(),
            "duration_ms": round(self._now_ms(), 1),
            "max_turns": self.options.max_turns,
            "caller_turns": self.caller_turns,
            "agent_turns": len(self.turns),
            "turns": self.turns,
            "latencies_ms": [turn["latency_ms"] for turn in self.turns],
            "interruptions": [],
            "evaluator_mode": "pipeline",
            "warnings": self.warnings,
            "event_counts": dict(Counter(e["type"] for e in self.events)),
        }


def _json_line(record: dict[str, Any]) -> str:
    return json.dumps(record, ensure_ascii=False) + "\n"
