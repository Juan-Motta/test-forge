"""OpenAI / Azure OpenAI Realtime (GA) adapter for the RealtimeCaller port.

Speaks the GA WebSocket protocol directly (the schema of `openai.types.realtime`): one
`session.update` with server turn detection off, `input_audio_buffer.append` for the agent's
audio, and per caller turn `input_audio_buffer.commit` + `response.create`, reading
`response.output_audio.delta`, `response.output_audio_transcript.done`,
`response.function_call_arguments.done` and `response.done`.

OpenAI: `wss://api.openai.com/v1/realtime?model=<model>` with `Authorization: Bearer`.
Azure OpenAI (v1 API): `wss://<resource>/openai/v1/realtime?model=<deployment>` with `api-key`.
The SDK's Azure client still dials the preview `/openai/realtime?deployment=` path, so the
frames are sent with `websockets` here.

Errors never carry the provider's message (it may quote the key): only its code or type.
"""

import asyncio
import base64
import contextlib
import json
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, InvalidStatus, WebSocketException

from voice_eval.ports.realtime_caller import (
    CallerAudio,
    CallerTranscript,
    HangUp,
    RealtimeCallerError,
    ResponseEvent,
)

PCM_FORMAT = {"type": "audio/pcm", "rate": 24000}
MIN_COMMIT_BYTES = 4800  # the model refuses to commit less than 100 ms of PCM16 24 kHz
MAX_MESSAGE_BYTES = 16 * 1024 * 1024
HANG_UP_TOOL = {
    "type": "function",
    "name": "hang_up",
    "description": (
        "End the phone call. Call it right after you said goodbye, when your goal is met or "
        "the conversation should end."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "reason": {"type": "string", "description": "Why you hang up, in a few words."}
        },
        "required": ["reason"],
        "additionalProperties": False,
    },
}


def session_config(instructions: str, voice: str, *, reasoning: bool) -> dict[str, Any]:
    """The `session` of the `session.update` the caller starts with."""
    config: dict[str, Any] = {
        "type": "realtime",
        "instructions": instructions,
        "output_modalities": ["audio"],
        "audio": {
            "input": {"format": PCM_FORMAT, "turn_detection": None},
            "output": {"format": PCM_FORMAT, "voice": voice},
        },
        "tools": [HANG_UP_TOOL],
        "tool_choice": "auto",
    }
    if reasoning:
        config["reasoning"] = {"effort": "low"}
    return config


def _ws_url(base: str, path: str, model: str) -> str:
    parts = urlsplit(base.rstrip("/"))
    scheme = {"https": "wss", "http": "ws"}.get(parts.scheme, parts.scheme)
    return urlunsplit((scheme, parts.netloc, parts.path + path, f"model={quote(model)}", ""))


def _error_code(error: Any) -> str:
    if isinstance(error, dict):
        for key in ("code", "type"):
            if isinstance(error.get(key), str) and error[key]:
                return error[key]
    return "unknown error"


class OpenAIRealtimeCaller:
    def __init__(
        self,
        url: str,
        headers: dict[str, str],
        voice: str,
        *,
        open_timeout_s: float = 15,
        idle_timeout_s: float = 15,
    ) -> None:
        self.url = url
        self.headers = headers
        self.voice = voice
        self.open_timeout_s = open_timeout_s
        self.idle_timeout_s = idle_timeout_s  # waiting for a cancelled response to end
        self._ws: ClientConnection | None = None
        self._reader: asyncio.Task[None] | None = None
        self._events: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self._buffered = 0  # appended bytes since the last commit
        self._stale: set[str] = set()  # ids of cancelled responses still running
        self._abandoned = 0  # responses cancelled before their id was known
        self._idle = asyncio.Event()  # no response is running on the server
        self._idle.set()

    def __repr__(self) -> str:  # never the headers: they hold the key
        return f"OpenAIRealtimeCaller(url={self.url!r}, voice={self.voice!r})"

    @classmethod
    def for_openai(
        cls, api_key: str, *, model: str, voice: str, base_url: str = "https://api.openai.com/v1"
    ) -> "OpenAIRealtimeCaller":
        url = _ws_url(base_url, "/realtime", model)
        return cls(url, {"Authorization": f"Bearer {api_key}"}, voice)

    @classmethod
    def for_azure(
        cls, api_key: str, *, endpoint: str, deployment: str, voice: str
    ) -> "OpenAIRealtimeCaller":
        url = _ws_url(endpoint, "/openai/v1/realtime", deployment)
        return cls(url, {"api-key": api_key}, voice)

    # --- connection -----------------------------------------------------------------------

    async def open(self, instructions: str) -> None:
        try:
            self._ws = await asyncio.wait_for(
                connect(
                    self.url,
                    additional_headers=self.headers,
                    max_size=MAX_MESSAGE_BYTES,
                    user_agent_header=None,
                ),
                self.open_timeout_s,
            )
        except InvalidStatus as exc:
            status = exc.response.status_code
            raise RealtimeCallerError(
                f"the realtime model refused the connection (HTTP {status})"
            ) from None
        except TimeoutError:
            raise RealtimeCallerError("the realtime model did not answer in time") from None
        except (OSError, WebSocketException) as exc:
            raise RealtimeCallerError(
                f"could not connect to the realtime model ({type(exc).__name__})"
            ) from None
        self._reader = asyncio.create_task(self._read())
        for reasoning in (True, False):
            await self._send(
                {
                    "type": "session.update",
                    "session": session_config(instructions, self.voice, reasoning=reasoning),
                }
            )
            error = await self._session_answer()
            if error is None:
                return
            if reasoning and "reasoning" in str(error.get("param") or ""):
                continue  # this model has no reasoning effort: configure it without
            raise RealtimeCallerError(f"the realtime session was refused ({_error_code(error)})")

    async def _session_answer(self) -> dict[str, Any] | None:
        """None once the session is updated; the error when the update was refused."""
        try:
            async with asyncio.timeout(self.open_timeout_s):
                while True:
                    event = await self._next()
                    if event["type"] == "session.updated":
                        return None
                    if event["type"] == "error":
                        return event.get("error") or {}
        except TimeoutError:
            raise RealtimeCallerError("the realtime session was not configured in time") from None

    async def close(self) -> None:
        if self._ws is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._ws.close(), 5)
        if self._reader is not None:
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._reader

    async def _send(self, event: dict[str, Any]) -> None:
        if self._ws is None:
            raise RealtimeCallerError("the realtime caller is not connected")
        try:
            await self._ws.send(json.dumps(event))
        except (ConnectionClosed, WebSocketException):
            raise RealtimeCallerError("the realtime connection closed") from None

    async def _read(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                try:
                    event = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(event, dict) and isinstance(event.get("type"), str):
                    self._route(event)
        except (ConnectionClosed, WebSocketException):
            pass
        finally:
            self._events.put_nowait(None)

    def _route(self, event: dict[str, Any]) -> None:
        """Drop what belongs to a cancelled response; queue the rest for the consumer."""
        kind = event["type"]
        if kind == "response.created":
            rid = (event.get("response") or {}).get("id")
            self._idle.clear()
            if self._abandoned:
                self._abandoned -= 1
                self._stale.add(rid)
                return
        rid = event.get("response_id") or (event.get("response") or {}).get("id")
        if kind == "response.done":
            if rid in self._stale:
                self._stale.discard(rid)
                if not self._stale and not self._abandoned:
                    self._idle.set()
                return
            self._idle.set()
        elif rid is not None and rid in self._stale:
            return
        self._events.put_nowait(event)

    async def _next(self) -> dict[str, Any]:
        event = await self._events.get()
        if event is None:
            self._events.put_nowait(None)  # every later read sees the end too
            raise RealtimeCallerError("the realtime connection closed")
        return event

    # --- turns ----------------------------------------------------------------------------

    async def append(self, pcm: bytes) -> None:
        if not pcm:
            return
        await self._send(
            {"type": "input_audio_buffer.append", "audio": base64.b64encode(pcm).decode()}
        )
        self._buffered += len(pcm)

    async def tool_output(self, call_id: str, output: str) -> None:
        await self._send(
            {
                "type": "conversation.item.create",
                "item": {"type": "function_call_output", "call_id": call_id, "output": output},
            }
        )

    async def respond(self, note: str | None = None) -> AsyncIterator[ResponseEvent]:
        try:
            async with asyncio.timeout(self.idle_timeout_s):
                await self._idle.wait()  # a cancelled response must end before a new one
        except TimeoutError:
            raise RealtimeCallerError("a cancelled realtime response did not end") from None
        self._drain_stray()
        if self._buffered:
            if self._buffered < MIN_COMMIT_BYTES:
                await self.append(bytes(MIN_COMMIT_BYTES - self._buffered))
            await self._send({"type": "input_audio_buffer.commit"})
            self._buffered = 0
        if note:
            await self._send(
                {
                    "type": "conversation.item.create",
                    "item": {
                        "type": "message",
                        "role": "system",
                        "content": [{"type": "input_text", "text": note}],
                    },
                }
            )
        await self._send({"type": "response.create"})
        self._idle.clear()
        rid: str | None = None
        finished = False
        try:
            while True:
                event = await self._next()
                kind = event["type"]
                if kind == "error":
                    raise RealtimeCallerError(
                        f"the realtime model failed ({_error_code(event.get('error'))})"
                    )
                if kind == "response.created":
                    rid = (event.get("response") or {}).get("id")
                    continue
                if rid is None or event.get("response_id", rid) != rid:
                    continue  # not this response's
                match kind:
                    case "response.output_audio.delta":
                        pcm = base64.b64decode(event.get("delta") or "")
                        if pcm:
                            yield CallerAudio(pcm)
                    case "response.output_audio_transcript.done":
                        yield CallerTranscript(str(event.get("transcript") or "").strip())
                    case "response.function_call_arguments.done" if event.get("name") == "hang_up":
                        yield HangUp(str(event.get("call_id") or ""), _reason(event))
                    case "response.done":
                        finished = True
                        response = event.get("response") or {}
                        if response.get("status") == "failed":
                            details = response.get("status_details") or {}
                            raise RealtimeCallerError(
                                "the realtime response failed "
                                f"({_error_code(details.get('error'))})"
                            )
                        return
        finally:
            if not finished:
                await self._abandon(rid)

    async def _abandon(self, rid: str | None) -> None:
        """Cancel the running response; whatever else it sends is dropped."""
        if rid is None:  # its `response.created` may already be queued
            kept = []
            while not self._events.empty():
                event = self._events.get_nowait()
                if rid is None and event is not None and event["type"] == "response.created":
                    rid = (event.get("response") or {}).get("id")
                    continue
                kept.append(event)
            for event in kept:
                self._events.put_nowait(event)
        if rid is not None:
            self._stale.add(rid)
        else:
            self._abandoned += 1
        with contextlib.suppress(RealtimeCallerError):
            await self._send({"type": "response.cancel"})

    def _drain_stray(self) -> None:
        """Forget queued events from before this turn (the end marker stays)."""
        while not self._events.empty():
            event = self._events.get_nowait()
            if event is None:
                self._events.put_nowait(None)
                return


def _reason(event: dict[str, Any]) -> str:
    try:
        arguments = json.loads(event.get("arguments") or "{}")
    except ValueError:
        return ""
    reason = arguments.get("reason") if isinstance(arguments, dict) else None
    return reason.strip() if isinstance(reason, str) else ""
