"""The conversation recording of a run: agent and caller mixed in one mono WAV (PCM16, 24 kHz).

Both sides are placed on the run timeline as the levels place them (see `levels`), so pauses,
overlaps and the cut of an interrupted agent turn sound as they happened. Overlapping samples
are summed and clipped to PCM16. Built on demand from the run's artifacts, so it works for any
run that has `agent.wav` or `caller.wav`, and kept next to them as `conversation.wav` (a finished
run's artifacts never change) so it is mixed once and served as a file the player can seek in.
"""

import io
import sys
import uuid
import wave
from array import array
from pathlib import Path
from typing import Any

from voice_eval.audio import CHANNELS, SAMPLE_RATE, SAMPLE_WIDTH
from voice_eval.modules.runs.levels import SAMPLES_PER_MS, place_audio

PCM16_MIN, PCM16_MAX = -32768, 32767
CONVERSATION_FILE = "conversation.wav"


def _mix(segments: list[tuple[int, array]], length: int) -> array:
    """Each segment written at its start sample; where it meets audio already written, the two
    are summed and clipped. Placed from the earliest start, so everything past `written` is
    still silence and is copied as is (one side's segments never overlap: only the overlaps
    between sides are mixed sample by sample)."""
    out = array("h", bytes(SAMPLE_WIDTH * length))
    written = 0
    for first, samples in sorted(segments, key=lambda segment: segment[0]):
        samples = samples[: max(0, length - first)]
        end = first + len(samples)
        overlap = max(0, min(end, written) - first)
        for index in range(overlap):
            out[first + index] = min(PCM16_MAX, max(PCM16_MIN, out[first + index] + samples[index]))
        out[first + overlap : end] = samples[overlap:]
        written = max(written, end)
    return out


def build_conversation(artifacts: Path, summary: dict[str, Any] | None = None) -> bytes | None:
    """The run's conversation as WAV bytes; None when the run has no audio file.

    `summary` is the stored one, used when `summary.json` cannot be read.
    """
    if not any((artifacts / f"{side}.wav").is_file() for side in ("agent", "caller")):
        return None
    placed = place_audio(artifacts, summary)
    segments = [(round(start * SAMPLES_PER_MS), s) for start, s in (*placed.agent, *placed.caller)]
    length = max([round(placed.duration_ms * SAMPLES_PER_MS), *(f + len(s) for f, s in segments)])
    pcm = _mix(segments, length)
    if sys.byteorder == "big":  # WAV PCM is little-endian
        pcm.byteswap()
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(CHANNELS)
        w.setsampwidth(SAMPLE_WIDTH)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return out.getvalue()


def conversation_file(artifacts: Path, summary: dict[str, Any] | None = None) -> Path | None:
    """The kept `conversation.wav` of a finished run, mixed and written on first use; None when
    the run has no audio file. Written to a temporary name unique to the call first (a player's
    overlapping first requests may mix at once), so a reader never sees half a file."""
    path = artifacts / CONVERSATION_FILE
    if path.is_file():
        return path
    wav = build_conversation(artifacts, summary)
    if wav is None:
        return None
    partial = path.with_name(f".{CONVERSATION_FILE}.{uuid.uuid4().hex}.part")
    partial.write_bytes(wav)
    partial.replace(path)
    return path
