"""Pure PCM16 mono 24 kHz helpers shared by targets, providers and the probe."""

import base64
import wave
from pathlib import Path

SAMPLE_RATE = 24_000
SAMPLE_WIDTH = 2
CHANNELS = 1
BYTES_PER_MS = SAMPLE_RATE * SAMPLE_WIDTH // 1000
FRAME_MS = 100
FRAME_BYTES = FRAME_MS * BYTES_PER_MS
MAX_B64_CHARS = 131_072


class AudioFormatError(ValueError):
    pass


def chunk_pcm(pcm: bytes, frame_bytes: int = FRAME_BYTES) -> list[bytes]:
    if frame_bytes <= 0 or frame_bytes % 2:
        raise ValueError(f"frame_bytes must be a positive even number, got {frame_bytes}")
    frames = [pcm[i : i + frame_bytes] for i in range(0, len(pcm), frame_bytes)]
    if frames and len(frames[-1]) % 2:
        frames[-1] += b"\x00"
    return frames


def silence(ms: int) -> bytes:
    return b"\x00" * (ms * BYTES_PER_MS)


def duration_ms(pcm: bytes) -> float:
    return len(pcm) / BYTES_PER_MS


def b64encode(pcm: bytes) -> str:
    return base64.b64encode(pcm).decode("ascii")


def b64decode(data: str) -> bytes:
    return base64.b64decode(data)


def read_wav_pcm16_24k(path: str | Path) -> bytes:
    with wave.open(str(path), "rb") as w:
        problems = []
        if w.getnchannels() != CHANNELS:
            problems.append(f"expected mono, got {w.getnchannels()} channels")
        if w.getsampwidth() != SAMPLE_WIDTH:
            problems.append(f"expected 16-bit samples, got {w.getsampwidth() * 8}-bit")
        if w.getframerate() != SAMPLE_RATE:
            problems.append(f"expected {SAMPLE_RATE} Hz, got {w.getframerate()} Hz")
        if problems:
            raise AudioFormatError(f"{path}: " + "; ".join(problems))
        return w.readframes(w.getnframes())


def write_wav(path: str | Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(CHANNELS)
        w.setsampwidth(SAMPLE_WIDTH)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)
