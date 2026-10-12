from collections.abc import AsyncIterator
from typing import Protocol


class SynthesisError(RuntimeError):
    """A provider returned no usable speech."""


class SpeechSynthesizer(Protocol):
    """Turns caller text into speech for the target conversation."""

    async def synthesize(self, text: str) -> bytes:
        """Return raw PCM16 little-endian mono 24 kHz audio (no container header)."""
        ...

    def stream(self, text: str) -> AsyncIterator[bytes]:
        """Yield the same audio as `synthesize`, chunk by chunk as the provider produces it.

        Every chunk has an even length (whole samples). Raises `SynthesisError` when the
        provider returns no usable speech; closing the iterator early releases the request.
        """
        ...
