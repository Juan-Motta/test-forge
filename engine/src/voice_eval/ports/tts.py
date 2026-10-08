from typing import Protocol


class SynthesisError(RuntimeError):
    """A provider returned no usable speech."""


class SpeechSynthesizer(Protocol):
    """Turns caller text into speech for the target conversation."""

    async def synthesize(self, text: str) -> bytes:
        """Return raw PCM16 little-endian mono 24 kHz audio (no container header)."""
        ...
