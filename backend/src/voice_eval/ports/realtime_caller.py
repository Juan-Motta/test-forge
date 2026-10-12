"""Port for the realtime evaluator: a speech-to-speech model that plays the caller.

It hears the agent's audio (`append`) and answers by voice when the runner says it is the
caller's turn (`respond`); the runner keeps the turn control (no server turn detection). A
response yields the caller's audio as it is generated, the transcript of what it said, and a
`HangUp` when the model calls its `hang_up` tool. Failures raise `RealtimeCallerError`, whose
message is safe to store (never a key, a URL or a provider payload).
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

REALTIME_VOICES = (
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "sage",
    "shimmer",
    "verse",
    "marin",
    "cedar",
)
DEFAULT_REALTIME_VOICE = "alloy"


def realtime_voice(voice: str | None) -> str:
    """`voice` when the realtime model has it, else the default realtime voice."""
    return voice if voice in REALTIME_VOICES else DEFAULT_REALTIME_VOICE


class RealtimeCallerError(RuntimeError):
    """The realtime caller failed; the message is safe to show and store."""


@dataclass(frozen=True)
class CallerAudio:
    """A chunk of the caller's speech: PCM16 24 kHz mono, whole samples."""

    pcm: bytes


@dataclass(frozen=True)
class CallerTranscript:
    """What the caller said in this response (its output audio transcript)."""

    text: str


@dataclass(frozen=True)
class HangUp:
    """The model called `hang_up`; answer it with `tool_output(call_id, ...)`."""

    call_id: str
    reason: str


ResponseEvent = CallerAudio | CallerTranscript | HangUp


class RealtimeCaller(Protocol):
    async def open(self, instructions: str) -> None:
        """Connect and configure the session (who the caller is, voice, `hang_up` tool)."""
        ...

    async def append(self, pcm: bytes) -> None:
        """Add agent audio (PCM16 24 kHz mono) to what the caller hears next."""
        ...

    def respond(self, note: str | None = None) -> AsyncIterator[ResponseEvent]:
        """The caller's turn: commit what it heard, add `note` (context for the model, never
        spoken to the agent), and stream its response until it is done.

        Closing the iterator early cancels the response.
        """
        ...

    async def tool_output(self, call_id: str, output: str) -> None:
        """Answer a tool call (no new response is requested)."""
        ...

    async def close(self) -> None:
        """Disconnect; never raises."""
        ...
