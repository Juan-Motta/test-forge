"""Port for a text (chat) target: the text runner talks to this, never to a wire protocol.

`send` posts one user message to a conversation (`thread_id`; the same id continues it) and
yields the reply as events, always ending with `ReplyEnded` or raising `TextTargetError`.
Timings are milliseconds from the moment the request is sent.
"""

from collections.abc import AsyncIterator
from contextlib import aclosing
from dataclasses import dataclass
from typing import Protocol


class TextTargetError(RuntimeError):
    """The message could not be answered. The message is safe to show: it never carries the
    agent's response body or a credential. `status` is the HTTP status, when there was one."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class TextDelta:
    """A piece of the reply's text, in order."""

    text: str


@dataclass(frozen=True)
class ToolStarted:
    name: str


@dataclass(frozen=True)
class ToolEnded:
    name: str
    success: bool | None = None
    elapsed_ms: int | None = None


@dataclass(frozen=True)
class ReplyEnded:
    """The reply is complete: its full text, when its first text arrived, and when it ended."""

    text: str
    first_text_ms: int | None
    total_ms: int


TextEvent = TextDelta | ToolStarted | ToolEnded | ReplyEnded


@dataclass(frozen=True)
class TextReply:
    text: str
    first_text_ms: int | None
    total_ms: int
    tools: tuple[str, ...] = ()


class TextTarget(Protocol):
    def send(self, message: str, *, thread_id: str) -> AsyncIterator[TextEvent]: ...


async def collect(events: AsyncIterator[TextEvent]) -> TextReply:
    """Consume a reply's events into one `TextReply` (tools in the order they started).

    The events are always closed when this returns or raises, so nothing the target opened for
    the reply (a client, a response) outlives it.
    """
    tools: list[str] = []
    async with aclosing(events) as stream:
        async for event in stream:
            if isinstance(event, ToolStarted):
                tools.append(event.name)
            elif isinstance(event, ReplyEnded):
                return TextReply(event.text, event.first_text_ms, event.total_ms, tuple(tools))
    raise TextTargetError("The agent's reply ended without a final event")
