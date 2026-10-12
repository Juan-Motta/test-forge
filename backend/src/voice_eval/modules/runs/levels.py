"""Audio levels of a finished run: one RMS value per time bin for each side, on the run timeline.

The WAV artifacts are not aligned in time. `agent.wav` holds every chunk of agent audio the
runner kept, back to back, without the pauses between turns; `caller.wav` holds every frame the
caller's open microphone sent (one per 100 ms of wall time), silence included. So the levels are
placed with `events.jsonl`, which records each audio chunk in order with its run time (`t_ms`)
and size (`bytes`):

- Agent: the n-th `agent_audio` event is the n-th chunk of `agent.wav`. Chunks arrive faster
  than real time, so they are played back like a phone would: each starts when it arrived or
  when the previous one finished, whichever is later. A `caller_interrupted` event stops that
  playback at its time (what was received but not yet played is dropped), as a listener who
  cut in would hear it.
- Caller: only speech frames produce a `caller_audio` event (an all-zero frame is silence and
  never published), so the frames of `caller.wav` are matched to the events in order, skipping
  silent 100 ms frames; each speech frame starts at the time it was sent.

Bins split `[0, durationMs)` evenly; `durationMs` is the summary's duration, extended when audio
plays past it. Values are RMS over the whole bin (silence counts) on one scale for both lanes:
the loudest bin of either side is 1. Turns come from `transcript.json` (refs `A<n>`/`C<n>`, as
the judge cites them). A run without events or audio gets silent lanes.
"""

import json
import math
import sys
import wave
from array import array
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from voice_eval.audio import BYTES_PER_MS, FRAME_BYTES, SAMPLE_WIDTH

SAMPLES_PER_MS = BYTES_PER_MS // SAMPLE_WIDTH
MIN_BINS = 20
MAX_BINS = 400
DEFAULT_BINS = 140

Segment = tuple[float, array]  # start (run ms), PCM16 samples


@dataclass(frozen=True)
class RunLevels:
    duration_ms: int
    agent: list[float]
    caller: list[float]
    turns: list[dict[str, Any]]


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _events(path: Path) -> list[dict[str, Any]]:
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return []
    events = []
    for line in lines:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict) and _number(event.get("t_ms")) is not None:
            events.append(event)
    return events


def _pcm(path: Path) -> bytes:
    try:
        with wave.open(str(path), "rb") as w:
            if w.getsampwidth() != SAMPLE_WIDTH:
                return b""
            return w.readframes(w.getnframes())
    except (OSError, EOFError, wave.Error):
        return b""


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) else None


def _samples(pcm: bytes) -> array:
    samples = array("h")
    samples.frombytes(pcm[: len(pcm) - len(pcm) % SAMPLE_WIDTH])
    if sys.byteorder == "big":  # WAV PCM is little-endian
        samples.byteswap()
    return samples


def _chunk_bytes(event: dict[str, Any]) -> int:
    size = event.get("bytes")
    return size if isinstance(size, int) and not isinstance(size, bool) and size > 0 else 0


def _agent_segments(events: list[dict[str, Any]], pcm: bytes) -> list[Segment]:
    segments: list[list[Any]] = []  # [start, end, samples]
    offset = 0
    playhead = 0.0
    for event in events:
        if event.get("type") == "caller_interrupted":
            cut = event["t_ms"]
            kept = []
            for segment in segments:
                start, end, samples = segment
                if start >= cut:
                    continue
                if end > cut:
                    segment[1] = cut
                    segment[2] = samples[: round((cut - start) * SAMPLES_PER_MS)]
                kept.append(segment)
            segments = kept
            playhead = min(playhead, cut)
            continue
        if event.get("type") != "agent_audio" or not (size := _chunk_bytes(event)):
            continue
        chunk = pcm[offset : offset + size]
        offset += size
        if not chunk:
            break  # the WAV is shorter than the events: nothing more to place
        start = max(playhead, event["t_ms"])
        playhead = start + len(chunk) / BYTES_PER_MS
        segments.append([start, playhead, _samples(chunk)])
    return [(start, samples) for start, _, samples in segments]


def _silent(frame: bytes) -> bool:
    return not frame.strip(b"\x00")


def _caller_segments(events: list[dict[str, Any]], pcm: bytes) -> list[Segment]:
    segments: list[Segment] = []
    offset = 0
    playhead = 0.0
    for event in events:
        if event.get("type") != "caller_audio" or not (size := _chunk_bytes(event)):
            continue
        # Silence frames of the open microphone sit between speech frames, without events.
        while offset < len(pcm) and _silent(pcm[offset : offset + FRAME_BYTES]):
            offset += FRAME_BYTES
        chunk = pcm[offset : offset + size]
        offset += size
        if not chunk:
            break
        start = max(playhead, event["t_ms"])
        playhead = start + len(chunk) / BYTES_PER_MS
        segments.append((start, _samples(chunk)))
    return segments


def _energy(segments: list[Segment], bins: int, bin_ms: float) -> list[float]:
    """Sum of squared samples per bin."""
    energy = [0.0] * bins
    for start, samples in segments:
        first = int(start // bin_ms)
        index = 0
        while index < len(samples) and first < bins:
            bin_end = (first + 1) * bin_ms
            stop = min(len(samples), max(index + 1, round((bin_end - start) * SAMPLES_PER_MS)))
            part = samples[index:stop]
            energy[first] += float(math.sumprod(part, part))
            index = stop
            first += 1
    return energy


def _turns(transcript: Any) -> list[dict[str, Any]]:
    if not isinstance(transcript, list):
        return []
    turns, counts = [], {"agent": 0, "caller": 0}
    for row in transcript:
        if not isinstance(row, dict) or row.get("role") not in counts:
            continue
        role = row["role"]
        counts[role] += 1
        start = _number(row.get("start_ms"))
        end = _number(row.get("playback_end_ms")) or _number(row.get("end_ms"))
        if start is None:
            continue
        turns.append(
            {
                "role": role,
                "startMs": round(start),
                "endMs": round(max(start, end if end is not None else start)),
                "ref": f"{'A' if role == 'agent' else 'C'}{counts[role]}",
            }
        )
    return turns


def build_levels(
    artifacts: Path | None, *, bins: int, summary: dict[str, Any] | None = None
) -> RunLevels:
    """The levels of the run whose artifacts are in `artifacts` (missing files: silence).

    `summary` is the stored one, used when `summary.json` cannot be read.
    """
    if artifacts is not None and isinstance(stored := _read_json(artifacts / "summary.json"), dict):
        summary = stored
    events = _events(artifacts / "events.jsonl") if artifacts is not None else []
    agent = caller = []
    if events and artifacts is not None:
        agent = _agent_segments(events, _pcm(artifacts / "agent.wav"))
        caller = _caller_segments(events, _pcm(artifacts / "caller.wav"))
    ends = [start + len(samples) / SAMPLES_PER_MS for start, samples in (*agent, *caller)]
    duration = _number((summary or {}).get("duration_ms")) or 0.0
    duration = max([duration, *ends])
    turns = _turns(_read_json(artifacts / "transcript.json") if artifacts is not None else None)
    if duration <= 0:
        return RunLevels(0, [0.0] * bins, [0.0] * bins, turns)
    bin_ms = duration / bins
    bin_samples = bin_ms * SAMPLES_PER_MS
    agent_rms = [math.sqrt(e / bin_samples) for e in _energy(agent, bins, bin_ms)]
    caller_rms = [math.sqrt(e / bin_samples) for e in _energy(caller, bins, bin_ms)]
    peak = max([*agent_rms, *caller_rms])

    def scaled(values: list[float]) -> list[float]:
        return [round(v / peak, 4) if peak > 0 else 0.0 for v in values]

    return RunLevels(round(duration), scaled(agent_rms), scaled(caller_rms), turns)
