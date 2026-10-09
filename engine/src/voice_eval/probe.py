"""`voice-probe`: hold one scripted conversation with a Vivi voice agent and record it.

The probe talks to a `TargetSession` and never to a wire protocol; `open_target` picks the
Live or the legacy realtime adapter.
"""

import argparse
import asyncio
import json
import logging
import sys
import time
from collections import Counter
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from websockets.exceptions import ConnectionClosed

from voice_eval.audio import BYTES_PER_MS, duration_ms, read_wav_pcm16_24k, write_wav
from voice_eval.caller_stream import CallerAudioStream
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
    TranscriptUpdate,
)
from voice_eval.ports.tts import SpeechSynthesizer
from voice_eval.targets.detect import PROTOCOLS, ProtocolDetectionError, TargetSpec, open_target
from voice_eval.turns import AgentTurn, AgentTurnDetector, ResponseTurnTracker

log = logging.getLogger(__name__)

POLL_S = 0.05
FALLBACK_GAP_MIN_MS = 5000  # tool runs tick every second; never end on a shorter gap there


class ProbeStop(Exception):
    """The conversation cannot continue (socket closed or run deadline reached)."""


@dataclass
class ProbeOptions:
    silence_gap_ms: int = 900
    settle_ms: int = 1200
    max_seconds: float = 180
    turn_timeout_s: float = 30
    ready_timeout_s: float = 15
    close_timeout_s: float = 5
    trailing_silence_ms: int = 600
    agent_first: bool = False


@dataclass(frozen=True)
class CallerTurn:
    """One caller turn: speech (`pcm`) or a text message (`text`, legacy protocol only)."""

    pcm: bytes | None = None
    text: str | None = None


@dataclass
class ProbeRun:
    spec: TargetSpec
    out_dir: Path
    options: ProbeOptions = field(default_factory=ProbeOptions)

    def __post_init__(self) -> None:
        self.session: TargetSession | None = None
        self.detector: AgentTurnDetector = AgentTurnDetector(self.options.silence_gap_ms)
        self.stream: CallerAudioStream | None = None
        self.events: list[dict[str, Any]] = []
        self.agent_pcm = bytearray()
        self.warnings: list[str] = []
        self.caller_turns = 0
        self.expects_opening_turn = False
        self.stopped = False
        self.interrupted = False
        self.ready_ms: float | None = None
        self.closed: Closed | None = None
        self._captions: dict[str, str] = {}
        self._ready = asyncio.Event()
        self._closed = asyncio.Event()
        self._t0 = time.monotonic()
        self._started_at = datetime.now(UTC)
        self._reader: asyncio.Task[None] | None = None
        self._sender: asyncio.Task[None] | None = None

    def _now_ms(self) -> float:
        return (time.monotonic() - self._t0) * 1000

    async def run(self, turns: list[CallerTurn]) -> dict[str, Any]:
        self._t0 = time.monotonic()
        try:
            self.session = await open_target(self.spec, self.options.ready_timeout_s)
            if any(t.text is not None for t in turns) and not self.session.supports_text:
                raise ProbeStop(
                    f"--text caller turns are not supported by the {self.session.protocol} "
                    "protocol; use --say or --caller-wav"
                )
            self.detector = self._make_detector(self.session)
            self.stream = CallerAudioStream(self.session.send_caller_audio, self._now_ms)
            self._reader = asyncio.create_task(self._read())
            await self._wait_ready()
            self._sender = asyncio.create_task(self.stream.run())
            await self._opening_turn(self.session)
            for n, turn in enumerate(turns, 1):
                await self._caller_turn(self.session, self.stream, n, turn)
        except (ProbeStop, ProtocolDetectionError) as stop:
            self.stopped = True
            self.warnings.append(str(stop))
        except asyncio.CancelledError:
            self.interrupted = True
            raise
        finally:
            await self._shutdown()
            summary = self.summary()
            self.write_artifacts(summary)
        return summary

    def _make_detector(self, session: TargetSession) -> AgentTurnDetector:
        if session.explicit_turn_end:
            fallback = max(self.options.silence_gap_ms, FALLBACK_GAP_MIN_MS)
            return ResponseTurnTracker(self.options.settle_ms, fallback)
        return AgentTurnDetector(self.options.silence_gap_ms)

    async def _wait_ready(self) -> None:
        try:
            await asyncio.wait_for(self._ready.wait(), self.options.ready_timeout_s)
        except TimeoutError:
            raise ProbeStop("session ready event not received in time") from None

    async def _opening_turn(self, session: TargetSession) -> None:
        if not session.agent_speaks_first:
            if not self.options.agent_first:
                return  # the caller starts the conversation
            self._log_out({"type": "caller.request_agent_turn"})
            await session.request_agent_turn()
        self.expects_opening_turn = True
        await self._wait_agent_turn(1, "greeting", self.options.turn_timeout_s)

    async def _caller_turn(
        self, session: TargetSession, stream: CallerAudioStream, n: int, turn: CallerTurn
    ) -> None:
        expected = len(self.detector.completed_turns) + 1
        self.caller_turns += 1
        if turn.text is not None:
            self.detector.mark_caller_end(self._now_ms())
            self._log_out({"type": "caller.text", "text": turn.text})
            await session.send_caller_text(turn.text)
            budget = 0.0
        else:
            pcm = turn.pcm or b""
            stream.enqueue(pcm, self.options.trailing_silence_ms, self.detector.mark_caller_end)
            budget = (duration_ms(pcm) + self.options.trailing_silence_ms) / 1000
        await self._wait_agent_turn(expected, f"reply {n}", budget + self.options.turn_timeout_s)

    def _log_out(self, record: dict[str, Any]) -> None:
        self.events.append({"t_ms": round(self._now_ms(), 1), "dir": "out", **record})

    async def _wait_agent_turn(self, expected: int, label: str, timeout_s: float) -> None:
        deadline = min(self._now_ms() + timeout_s * 1000, self.options.max_seconds * 1000)
        while True:
            self.detector.turn_ended(self._now_ms())
            if len(self.detector.completed_turns) >= expected:
                return
            if self._reader is not None and self._reader.done():
                raise ProbeStop(f"connection closed while waiting for agent {label}")
            if self._now_ms() >= self.options.max_seconds * 1000:
                raise ProbeStop(f"max run time reached while waiting for agent {label}")
            if self._now_ms() >= deadline:
                self.warnings.append(f"timed out waiting for agent {label} to end")
                return
            await asyncio.sleep(POLL_S)

    async def _read(self) -> None:
        assert self.session is not None
        try:
            async for event in self.session.events():
                self._on_event(self._now_ms(), event)
        except Exception as exc:  # keep the run alive long enough to write artifacts
            self.warnings.append(f"reader failed: {exc!r}")

    def _on_event(self, t: float, event: ServerEvent) -> None:
        record: dict[str, Any] = {"t_ms": round(t, 1), "dir": "in", **event.raw}
        match event:
            case AudioDelta(pcm=pcm):
                record.pop("delta", None)
                record["bytes"] = len(pcm)
                self.agent_pcm += pcm
                self.detector.on_agent_audio(t, len(pcm))
            case Ready():
                self.ready_ms = t
                self._ready.set()
            case TranscriptUpdate(role="assistant", message_id=mid, text=text):
                if self._captions.get(mid) != text:
                    self._captions[mid] = text
                    self.detector.on_caption_change(t)
            case ResponseStarted():
                self.detector.on_response_started(t)
            case ResponseDone():
                self.detector.on_response_done(t)
            case AgentBusy():
                self.detector.on_busy(t)
            case ServerError(message=message):
                self.warnings.append(f"server error: {message}")
            case Closed():
                self.closed = event
                self._closed.set()
        self.events.append(record)

    async def _shutdown(self) -> None:
        if self._sender is not None:
            self._sender.cancel()
            with suppress(asyncio.CancelledError, ConnectionClosed):
                await self._sender
        if self.session is None:
            return
        if self._reader is None:  # stopped before reading: still record the closing events
            self._reader = asyncio.create_task(self._read())
        if not self._reader.done():
            try:
                timeout = self.options.close_timeout_s
                self._log_out(await asyncio.wait_for(self.session.close(), timeout))
                await asyncio.wait_for(asyncio.shield(self._reader), timeout)
            except (TimeoutError, ConnectionClosed):
                self.warnings.append("graceful session close not confirmed in time")
        with suppress(Exception):
            await self.session.disconnect()
        if self._reader is not None and not self._reader.done():
            self._reader.cancel()
            with suppress(asyncio.CancelledError):
                await self._reader
        self.detector.turn_ended(self._now_ms())

    def summary(self) -> dict[str, Any]:
        session = self.session
        turns = list(self.detector.completed_turns)
        if self.detector.current_turn is not None:
            turns.append(self.detector.current_turn)
        expected_turns = self.caller_turns + int(self.expects_opening_turn)
        return {
            "protocol": session.protocol if session else None,
            "model": session.model if session else None,
            "thread_id": self.spec.thread_id,
            "langfuse_session_id": self.spec.thread_id,
            "session_id": session.session_id if session else None,
            "channel_id": self.spec.channel_id,
            "started_at": self._started_at.isoformat(),
            "duration_ms": round(self._now_ms(), 1),
            "ready_ms": self.ready_ms,
            "silence_gap_ms": self.options.silence_gap_ms,
            "settle_ms": self.options.settle_ms,
            "caller_turns": self.caller_turns,
            "agent_turns": len(self.detector.completed_turns),
            "turns": [_turn_record(i, t, self.expects_opening_turn) for i, t in enumerate(turns)],
            "latencies_ms": [round(v, 1) for v in self.detector.latencies_ms()],
            "complete": session is not None
            and not self.stopped
            and not self.interrupted
            and len(self.detector.completed_turns) >= expected_turns,
            "close_code": session.close_code if session else None,
            "close_reason": session.close_reason if session else None,
            "usage_seconds": self.closed.usage_seconds if self.closed else None,
            "final_usage_confirmed": self.closed.final_usage_confirmed if self.closed else None,
            "interrupted": self.interrupted,
            "warnings": self.warnings,
            "event_counts": dict(Counter(e.get("type") for e in self.events)),
        }

    def write_artifacts(self, summary: dict[str, Any]) -> None:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        with (self.out_dir / "events.jsonl").open("w") as f:
            for record in self.events:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        write_wav(self.out_dir / "agent.wav", bytes(self.agent_pcm))
        write_wav(self.out_dir / "caller.wav", bytes(self.stream.sent if self.stream else b""))
        transcript = [
            {
                "role": m.role,
                "message_id": m.message_id,
                "text": m.text,
                "start_ms": m.start_ms,
                "end_ms": m.end_ms,
            }
            for m in (self.session.transcript_messages() if self.session else [])
        ]
        _write_json(self.out_dir / "transcript.json", transcript)
        _write_json(self.out_dir / "summary.json", summary)


def _turn_record(index: int, turn: AgentTurn, opening_expected: bool) -> dict[str, Any]:
    if turn.caller_end_ms is not None:
        kind = "reply"
    else:
        kind = "greeting" if index == 0 and opening_expected else "unprompted"
    return {
        "index": index,
        "kind": kind,
        "caller_end_ms": _round(turn.caller_end_ms),
        "first_audio_ms": _round(turn.first_audio_ms),
        "end_ms": _round(turn.end_ms),
        "latency_ms": _round(turn.latency_ms),
        "audio_ms": round(turn.audio_bytes / BYTES_PER_MS, 1),
        "response_count": turn.response_count,
        "tool_activity": turn.tool_activity,
        "end_reason": turn.end_reason,
    }


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="voice-probe",
        description="Hold a scripted conversation with a Vivi voice agent (Live or legacy).",
    )
    p.add_argument("--base-url", required=True, help="e.g. wss://<host>")
    p.add_argument("--channel-id", required=True)
    p.add_argument("--user-id", required=True)
    p.add_argument("--thread-id", help="defaults to a fresh UUID4 (also the Langfuse session id)")
    p.add_argument("--origin", help="optional Origin header")
    p.add_argument(
        "--protocol",
        choices=PROTOCOLS,
        default="auto",
        help="target protocol; auto detects it from the first server frame (default)",
    )
    p.add_argument(
        "--say",
        dest="utterances",
        action="append",
        type=lambda text: ("say", text),
        default=[],
        metavar="TEXT",
        help="caller utterance synthesized with the configured TTS provider (repeatable)",
    )
    p.add_argument(
        "--caller-wav",
        dest="utterances",
        action="append",
        type=lambda path: ("wav", path),
        metavar="PATH",
        help="caller utterance from a 24 kHz mono PCM16 WAV file (repeatable, provider-free)",
    )
    p.add_argument(
        "--text",
        dest="utterances",
        action="append",
        type=lambda text: ("text", text),
        metavar="TEXT",
        help="caller turn sent as a text message (repeatable; legacy realtime protocol only)",
    )
    p.add_argument(
        "--agent-first",
        action="store_true",
        help="legacy protocol: ask the agent for an opening turn before the caller speaks",
    )
    p.add_argument(
        "--silence-gap-ms", type=int, default=900, help="Live: agent end-of-turn audio gap"
    )
    p.add_argument(
        "--settle-ms",
        type=int,
        default=1200,
        help="legacy: quiet time after response.done before the agent turn counts as over",
    )
    p.add_argument("--turn-timeout-s", type=float, default=30)
    p.add_argument("--max-seconds", type=float, default=180)
    p.add_argument("--out", type=Path, help="defaults to runs/<timestamp>-<threadId8>")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


async def load_caller_turns(
    specs: list[tuple[str, str]], synthesizer: SpeechSynthesizer | None
) -> list[CallerTurn]:
    turns = []
    for kind, value in specs:
        if kind == "text":
            turns.append(CallerTurn(text=value))
            continue
        if kind == "wav":
            turns.append(CallerTurn(pcm=read_wav_pcm16_24k(value)))
            continue
        if synthesizer is None:
            from voice_eval.config import TtsSettings
            from voice_eval.providers import build_synthesizer

            synthesizer = build_synthesizer(TtsSettings.from_env())
        turns.append(CallerTurn(pcm=await synthesizer.synthesize(value)))
    return turns


async def amain(argv: list[str] | None = None, synthesizer: SpeechSynthesizer | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING)
    if args.protocol == "live" and any(kind == "text" for kind, _ in args.utterances):
        print("error: --text caller turns need the legacy realtime protocol", file=sys.stderr)
        return 2
    try:
        # Prepare all caller audio before connecting: the agent would otherwise wait on TTS.
        turns = await load_caller_turns(args.utterances, synthesizer)
    except Exception as exc:
        print(f"error: could not prepare caller audio: {exc}", file=sys.stderr)
        return 2

    spec = TargetSpec(
        args.base_url,
        args.channel_id,
        args.user_id,
        origin=args.origin,
        protocol=args.protocol,
        **({"thread_id": args.thread_id} if args.thread_id else {}),
    )
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = args.out or Path("runs") / f"{stamp}-{spec.thread_id[:8]}"
    probe = ProbeRun(
        spec,
        out_dir,
        ProbeOptions(
            silence_gap_ms=args.silence_gap_ms,
            settle_ms=args.settle_ms,
            max_seconds=args.max_seconds,
            turn_timeout_s=args.turn_timeout_s,
            agent_first=args.agent_first,
        ),
    )
    try:
        summary = await probe.run(turns)
    except asyncio.CancelledError:
        print(f"interrupted; artifacts written to {out_dir}", file=sys.stderr)
        raise
    except (OSError, ConnectionClosed, ValueError) as exc:
        print(f"error: {exc!r}; partial artifacts in {out_dir}", file=sys.stderr)
        return 1
    print_summary(summary, out_dir)
    return 0 if summary["complete"] else 1


def print_summary(summary: dict[str, Any], out_dir: Path) -> None:
    print(f"protocol: {summary['protocol']}  model: {summary['model']}")
    print(f"thread_id (Langfuse session): {summary['thread_id']}")
    print(f"session_id: {summary['session_id']}")
    print(f"agent turns: {summary['agent_turns']}  caller turns: {summary['caller_turns']}")
    print(f"latencies ms: {summary['latencies_ms']}")
    print(
        f"close: code={summary['close_code']} usage_s={summary['usage_seconds']} "
        f"confirmed={summary['final_usage_confirmed']}"
    )
    for warning in summary["warnings"]:
        print(f"warning: {warning}")
    print(f"artifacts: {out_dir}")


def main() -> None:
    try:
        code = asyncio.run(amain())
    except KeyboardInterrupt:
        code = 130
    sys.exit(code)


if __name__ == "__main__":
    main()
