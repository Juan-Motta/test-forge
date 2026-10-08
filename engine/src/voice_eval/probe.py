"""`voice-probe`: hold one scripted spoken conversation with a Vivi Live agent and record it."""

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
from voice_eval.ports.tts import SpeechSynthesizer
from voice_eval.targets.vivi_live import (
    AudioDelta,
    Closed,
    Ready,
    ServerEvent,
    TranscriptUpdate,
    ViviLiveClient,
)
from voice_eval.turns import AgentTurn, AgentTurnDetector

log = logging.getLogger(__name__)

POLL_S = 0.05


class ProbeStop(Exception):
    """The conversation cannot continue (socket closed or run deadline reached)."""


@dataclass
class ProbeOptions:
    silence_gap_ms: int = 900
    max_seconds: float = 180
    turn_timeout_s: float = 30
    ready_timeout_s: float = 15
    close_timeout_s: float = 5
    trailing_silence_ms: int = 600


@dataclass
class ProbeRun:
    client: ViviLiveClient
    out_dir: Path
    options: ProbeOptions = field(default_factory=ProbeOptions)

    def __post_init__(self) -> None:
        self.detector = AgentTurnDetector(self.options.silence_gap_ms)
        self.stream = CallerAudioStream(self.client.send_audio_frame, self._now_ms)
        self.events: list[dict[str, Any]] = []
        self.agent_pcm = bytearray()
        self.warnings: list[str] = []
        self.caller_turns = 0
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

    async def run(self, utterances: list[bytes]) -> dict[str, Any]:
        self._t0 = time.monotonic()
        try:
            await self.client.connect()
            self._reader = asyncio.create_task(self._read())
            await self._wait_ready()
            self._sender = asyncio.create_task(self.stream.run())
            await self._wait_agent_turn(1, "greeting", self.options.turn_timeout_s)
            for n, pcm in enumerate(utterances, 1):
                expected = len(self.detector.completed_turns) + 1
                self.stream.enqueue(
                    pcm, self.options.trailing_silence_ms, self.detector.mark_caller_end
                )
                self.caller_turns += 1
                budget = (duration_ms(pcm) + self.options.trailing_silence_ms) / 1000
                await self._wait_agent_turn(
                    expected, f"reply {n}", budget + self.options.turn_timeout_s
                )
        except ProbeStop as stop:
            self.warnings.append(str(stop))
        except asyncio.CancelledError:
            self.interrupted = True
            raise
        finally:
            await self._shutdown()
            summary = self.summary()
            self.write_artifacts(summary)
        return summary

    async def _wait_ready(self) -> None:
        try:
            await asyncio.wait_for(self._ready.wait(), self.options.ready_timeout_s)
        except TimeoutError:
            raise ProbeStop("voice.ready not received in time") from None

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
        try:
            async for event in self.client.events():
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
            case Closed():
                self.closed = event
                self._closed.set()
        self.events.append(record)

    async def _shutdown(self) -> None:
        if self._sender is not None:
            self._sender.cancel()
            with suppress(asyncio.CancelledError, ConnectionClosed):
                await self._sender
        if self._reader is not None and not self._reader.done():
            try:
                await self.client.close()
                self.events.append(
                    {"t_ms": round(self._now_ms(), 1), "dir": "out", "type": "voice.close"}
                )
                await asyncio.wait_for(asyncio.shield(self._reader), self.options.close_timeout_s)
            except (TimeoutError, ConnectionClosed):
                self.warnings.append("voice.closed / socket close not received in time")
        with suppress(Exception):
            await self.client.disconnect()
        if self._reader is not None and not self._reader.done():
            self._reader.cancel()
            with suppress(asyncio.CancelledError):
                await self._reader
        self.detector.turn_ended(self._now_ms())

    def summary(self) -> dict[str, Any]:
        turns = list(self.detector.completed_turns)
        if self.detector.current_turn is not None:
            turns.append(self.detector.current_turn)
        return {
            "thread_id": self.client.thread_id,
            "langfuse_session_id": self.client.thread_id,
            "session_id": self.client.session_id,
            "channel_id": self.client.channel_id,
            "started_at": self._started_at.isoformat(),
            "duration_ms": round(self._now_ms(), 1),
            "ready_ms": self.ready_ms,
            "silence_gap_ms": self.options.silence_gap_ms,
            "caller_turns": self.caller_turns,
            "agent_turns": len(self.detector.completed_turns),
            "turns": [_turn_record(i, t) for i, t in enumerate(turns)],
            "latencies_ms": [round(v, 1) for v in self.detector.latencies_ms()],
            "complete": len(self.detector.completed_turns) >= self.caller_turns + 1
            and not self.interrupted,
            "close_code": self.client.close_code,
            "close_reason": self.client.close_reason,
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
        write_wav(self.out_dir / "caller.wav", bytes(self.stream.sent))
        transcript = [
            {
                "role": m.role,
                "message_id": m.message_id,
                "text": m.text,
                "start_ms": m.start_ms,
                "end_ms": m.end_ms,
            }
            for m in self.client.transcript.messages()
        ]
        _write_json(self.out_dir / "transcript.json", transcript)
        _write_json(self.out_dir / "summary.json", summary)


def _turn_record(index: int, turn: AgentTurn) -> dict[str, Any]:
    kind = "reply" if turn.caller_end_ms is not None else "greeting" if index == 0 else "unprompted"
    return {
        "index": index,
        "kind": kind,
        "caller_end_ms": _round(turn.caller_end_ms),
        "first_audio_ms": _round(turn.first_audio_ms),
        "end_ms": _round(turn.end_ms),
        "latency_ms": _round(turn.latency_ms),
        "audio_ms": round(turn.audio_bytes / BYTES_PER_MS, 1),
    }


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="voice-probe",
        description="Hold a scripted spoken conversation with a Vivi Live agent.",
    )
    p.add_argument("--base-url", required=True, help="e.g. wss://<host>")
    p.add_argument("--channel-id", required=True)
    p.add_argument("--user-id", required=True)
    p.add_argument("--thread-id", help="defaults to a fresh UUID4 (also the Langfuse session id)")
    p.add_argument("--origin", help="optional Origin header")
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
    p.add_argument("--silence-gap-ms", type=int, default=900, help="agent end-of-turn gap")
    p.add_argument("--turn-timeout-s", type=float, default=30)
    p.add_argument("--max-seconds", type=float, default=180)
    p.add_argument("--out", type=Path, help="defaults to runs/<timestamp>-<threadId8>")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


async def load_utterances(
    specs: list[tuple[str, str]], synthesizer: SpeechSynthesizer | None
) -> list[bytes]:
    utterances = []
    for kind, value in specs:
        if kind == "wav":
            utterances.append(read_wav_pcm16_24k(value))
            continue
        if synthesizer is None:
            from voice_eval.config import TtsSettings
            from voice_eval.providers import build_synthesizer

            synthesizer = build_synthesizer(TtsSettings.from_env())
        utterances.append(await synthesizer.synthesize(value))
    return utterances


async def amain(argv: list[str] | None = None, synthesizer: SpeechSynthesizer | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING)
    try:
        # Prepare all caller audio before connecting: the agent would otherwise wait on TTS.
        utterances = await load_utterances(args.utterances, synthesizer)
    except Exception as exc:
        print(f"error: could not prepare caller audio: {exc}", file=sys.stderr)
        return 2

    client = ViviLiveClient(
        args.base_url, args.channel_id, args.user_id, thread_id=args.thread_id, origin=args.origin
    )
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = args.out or Path("runs") / f"{stamp}-{client.thread_id[:8]}"
    probe = ProbeRun(
        client,
        out_dir,
        ProbeOptions(
            silence_gap_ms=args.silence_gap_ms,
            max_seconds=args.max_seconds,
            turn_timeout_s=args.turn_timeout_s,
        ),
    )
    try:
        summary = await probe.run(utterances)
    except asyncio.CancelledError:
        print(f"interrupted; artifacts written to {out_dir}", file=sys.stderr)
        raise
    except (OSError, ConnectionClosed, ValueError) as exc:
        print(f"error: {exc!r}; partial artifacts in {out_dir}", file=sys.stderr)
        return 1
    print_summary(summary, out_dir)
    return 0 if summary["complete"] else 1


def print_summary(summary: dict[str, Any], out_dir: Path) -> None:
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
