"""Text target over a Vivi channel API: `POST {base}/channelsApi/{channelId}/invoke|stream`.

The request body is `{message, threadId}`; the same `threadId` continues the conversation.
`invoke` answers one JSON `ConversationMessage` with the whole reply. `stream` answers
`text/event-stream` that is NOT standard SSE: one `data: <ConversationMessage JSON>` per line
(single newline, no `event:`/`id:` fields). The reply text is the `message` of every
`on_chat_model_stream` item with a null `type` (`type="reasoning"` is the model's reasoning,
skipped), tools are `on_tool_start`/`on_tool_end` (`metadata.toolName`), and the reply ends
with `on_chat_end`: a stream that stops without it failed.

Connections go through the SSRF egress guard unless a transport is injected (tests). Errors are
`TextTargetError` with a safe message: never the response body nor the API key.
"""

import json
import time
from collections.abc import AsyncIterator, Callable
from typing import Any, Literal
from urllib.parse import quote

import httpx

from voice_eval.platform.egress import DestinationNotAllowed, guarded_transport
from voice_eval.ports.text_target import (
    ReplyEnded,
    TextDelta,
    TextEvent,
    TextTargetError,
    ToolEnded,
    ToolStarted,
)

CONNECT_TIMEOUT_S = 10.0
READ_TIMEOUT_S = 120.0  # between two chunks: tools and long replies can be slow
MAX_REPLY_BYTES = 2 * 1024 * 1024  # the whole invoke body, or every stream line together
API_KEY_HEADER = "vivi-api-key"

TextMode = Literal["invoke", "stream"]


def _http_error(status: int, mode: str) -> TextTargetError:
    if status == 401:
        message = "The agent rejected the API key (HTTP 401)"
    elif status == 403:
        message = (
            "Access denied (HTTP 403): the API key is missing, the workspace subscription is "
            "not active, or the Origin is not allowed"
        )
    elif status == 404:
        message = "Channel not found (HTTP 404): check the base URL and the channel id"
    elif status == 409 and mode == "stream":
        message = "The agent has a response schema and cannot stream (HTTP 409): use invoke mode"
    elif status == 422:
        message = "The agent refused the message (HTTP 422): the threadId must be a UUID"
    elif status >= 500:
        message = f"The agent failed to answer (HTTP {status})"
    else:
        message = f"Unexpected answer from the agent (HTTP {status})"
    return TextTargetError(message, status=status)


def _tool_name(item: dict[str, Any]) -> str:
    metadata = item.get("metadata")
    name = metadata.get("toolName") if isinstance(metadata, dict) else None
    return name if isinstance(name, str) and name else "unknown tool"


def _tool_end(item: dict[str, Any]) -> ToolEnded:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    success = metadata.get("success")
    elapsed = metadata.get("elapsedMs")
    return ToolEnded(
        name=_tool_name(item),
        success=success if isinstance(success, bool) else None,
        elapsed_ms=elapsed if isinstance(elapsed, int) and not isinstance(elapsed, bool) else None,
    )


class HttpChatTarget:
    """One agent's chat endpoint. `allow_private` lets the guard reach local/private hosts."""

    def __init__(
        self,
        *,
        base_url: str,
        channel_id: str,
        mode: TextMode = "stream",
        api_key: str | None = None,
        origin: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        allow_private: bool = False,
        connect_timeout_s: float = CONNECT_TIMEOUT_S,
        read_timeout_s: float = READ_TIMEOUT_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.channel_id = channel_id
        self.mode = mode
        self._api_key = api_key
        self.origin = origin
        self._transport = transport
        self.allow_private = allow_private
        self.connect_timeout_s = connect_timeout_s
        self.read_timeout_s = read_timeout_s
        self._clock = clock

    def __repr__(self) -> str:  # never the API key
        return f"HttpChatTarget(base_url={self.base_url!r}, mode={self.mode!r})"

    @property
    def url(self) -> str:
        return f"{self.base_url}/channelsApi/{quote(self.channel_id, safe='')}/{self.mode}"

    def _headers(self) -> dict[str, str]:
        headers = {"accept": "text/event-stream" if self.mode == "stream" else "application/json"}
        if self._api_key:
            headers[API_KEY_HEADER] = self._api_key
        if self.origin:
            headers["origin"] = self.origin
        return headers

    async def send(self, message: str, *, thread_id: str) -> AsyncIterator[TextEvent]:
        transport = self._transport or guarded_transport(allow_private=self.allow_private)
        timeout = httpx.Timeout(self.read_timeout_s, connect=self.connect_timeout_s)
        started = self._clock()

        def elapsed_ms() -> int:
            return round((self._clock() - started) * 1000)

        try:
            async with (
                httpx.AsyncClient(transport=transport, timeout=timeout) as client,
                client.stream(
                    "POST",
                    self.url,
                    json={"message": message, "threadId": thread_id},
                    headers=self._headers(),
                ) as response,
            ):
                if not response.is_success:
                    raise _http_error(response.status_code, self.mode)
                if self.mode == "invoke":
                    text = await self._invoke_text(response)
                    total = elapsed_ms()
                    if text:
                        yield TextDelta(text)
                    yield ReplyEnded(text, total, total)
                    return
                async for event in self._stream(response, elapsed_ms):
                    yield event
        except TextTargetError:
            raise
        except DestinationNotAllowed:
            raise TextTargetError(
                "The agent's address is not allowed: it is a private or local address"
            ) from None
        except httpx.ConnectTimeout:
            raise TextTargetError(
                f"Could not connect: no answer within {self.connect_timeout_s:g} s"
            ) from None
        except httpx.TimeoutException:
            raise TextTargetError(
                f"No answer from the agent within {self.read_timeout_s:g} s"
            ) from None
        except httpx.ConnectError:
            raise TextTargetError(
                "Could not connect: the connection was refused or the host is unreachable"
            ) from None
        except httpx.HTTPError as exc:
            raise TextTargetError(
                f"The connection to the agent failed ({type(exc).__name__})"
            ) from None

    async def _invoke_text(self, response: httpx.Response) -> str:
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body += chunk
            if len(body) > MAX_REPLY_BYTES:
                raise TextTargetError("The agent's reply is too large")
        try:
            item = json.loads(body)
        except ValueError:
            item = None
        text = item.get("message") if isinstance(item, dict) else None
        if not isinstance(text, str):
            raise TextTargetError("The agent's reply is not a valid message")
        return text

    async def _stream(
        self, response: httpx.Response, elapsed_ms: Callable[[], int]
    ) -> AsyncIterator[TextEvent]:
        parts: list[str] = []
        first_text_ms: int | None = None
        received = 0
        async for raw in response.aiter_lines():  # splits on \n and \r\n
            received += len(raw)
            if received > MAX_REPLY_BYTES:
                raise TextTargetError("The agent's reply is too large")
            line = raw.strip()
            if not line.startswith("data:"):
                continue  # blank lines and anything that is not a data line
            try:
                item = json.loads(line[len("data:") :])
            except ValueError:
                item = None
            if not isinstance(item, dict):
                raise TextTargetError("The agent sent a malformed stream line")
            event, kind = item.get("event"), item.get("type")
            if event == "on_chat_end":
                yield ReplyEnded("".join(parts), first_text_ms, elapsed_ms())
                return
            if event == "on_chat_model_stream" and kind is None:
                text = item.get("message")
                if isinstance(text, str) and text:
                    if first_text_ms is None:
                        first_text_ms = elapsed_ms()
                    parts.append(text)
                    yield TextDelta(text)
            elif event == "on_tool_start" or kind == "tool_start":
                yield ToolStarted(_tool_name(item))
            elif event == "on_tool_end" or kind == "tool_end":
                yield _tool_end(item)
        raise TextTargetError(
            "The agent's stream ended before the reply finished (no on_chat_end event)"
        )
