"""Port for a realtime voice target: the probe talks to this, never to a wire protocol.

Adapters translate their wire events into the protocol-neutral events below. Events the probe
does not act on are yielded as `UnknownEvent` so they still reach `events.jsonl`.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Protocol


class NotSupportedError(RuntimeError):
    """The target's protocol cannot perform this operation."""


@dataclass(frozen=True, kw_only=True)
class ServerEvent:
    raw: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)


@dataclass(frozen=True, kw_only=True)
class Ready(ServerEvent):
    """The session accepts caller input."""

    session_id: str


@dataclass(frozen=True, kw_only=True)
class AudioDelta(ServerEvent):
    pcm: bytes
    item_id: str | None = None  # the conversation item it belongs to, when the protocol says
    response_id: str | None = None


@dataclass(frozen=True, kw_only=True)
class TranscriptUpdate(ServerEvent):
    """Cumulative caption for one message (replaces the previous text of that message)."""

    role: str
    message_id: str
    text: str
    start_ms: int | None
    end_ms: int | None


@dataclass(frozen=True, kw_only=True)
class ResponseStarted(ServerEvent):
    """Explicit start of one agent response (a turn may hold several)."""

    response_id: str | None = None


@dataclass(frozen=True, kw_only=True)
class ResponseDone(ServerEvent):
    """Explicit end of one agent response."""

    response_id: str | None = None


@dataclass(frozen=True, kw_only=True)
class AgentBusy(ServerEvent):
    """The agent is calling or running a tool: its turn is not over."""


@dataclass(frozen=True, kw_only=True)
class ItemTruncated(ServerEvent):
    """The agent's server confirmed it truncated a conversation item's audio (and its text) at
    `audio_end_ms`: what it will remember of that item after a reported barge-in."""

    item_id: str
    audio_end_ms: int | None


@dataclass(frozen=True, kw_only=True)
class ItemDeleted(ServerEvent):
    """The agent's server confirmed it deleted a conversation item (a barge-in before any of
    its audio played)."""

    item_id: str


@dataclass(frozen=True, kw_only=True)
class ServerError(ServerEvent):
    message: str


@dataclass(frozen=True, kw_only=True)
class Closed(ServerEvent):
    usage_seconds: float | None
    final_usage_confirmed: bool


@dataclass(frozen=True, kw_only=True)
class UnknownEvent(ServerEvent):
    type: str


@dataclass
class TranscriptMessage:
    message_id: str
    role: str
    text: str
    start_ms: int | None
    end_ms: int | None
    order: int


class TargetSession(Protocol):
    """One connected conversation with a target agent."""

    protocol: str  # "live" or "realtime"
    thread_id: str  # also the Langfuse session id
    channel_id: str
    session_id: str | None
    model: str | None
    agent_speaks_first: bool  # the agent greets without being asked
    explicit_turn_end: bool  # the protocol signals response start/end
    supports_text: bool  # caller turns may be sent as text
    supports_playback_interruption: bool  # the caller may report a barge-in on agent audio

    @property
    def close_code(self) -> int | None: ...

    @property
    def close_reason(self) -> str | None: ...

    def events(self) -> AsyncIterator[ServerEvent]:
        """Yield normalized server events until the socket closes."""
        ...

    async def send_caller_audio(self, pcm: bytes) -> None:
        """Send one PCM16 mono 24 kHz frame of the caller's open microphone."""
        ...

    async def send_caller_text(self, text: str) -> None:
        """Send a caller message as text and ask for a reply (NotSupportedError if unable)."""
        ...

    async def request_agent_turn(self) -> None:
        """Ask the agent to speak without caller input (NotSupportedError if unable)."""
        ...

    async def send_playback_interrupted(
        self, item_id: str, response_id: str, audio_end_ms: int | None
    ) -> None:
        """Report that the caller cut the agent's audio item after `audio_end_ms` ms of playback
        (None: not played at all). NotSupportedError if the protocol has no such report."""
        ...

    async def close(self) -> dict[str, Any]:
        """End the session gracefully; return a record of what was sent."""
        ...

    async def disconnect(self) -> None: ...

    def transcript_messages(self) -> list[TranscriptMessage]: ...
