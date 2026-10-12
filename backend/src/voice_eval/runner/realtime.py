"""Realtime evaluator plumbing: what the speech-to-speech caller hears and how it answers.

`AgentAudioFeed` appends the agent's audio to the realtime caller as it arrives, in order, from
one background task. The audio of an agent turn the scenario will cut is held instead, and only
the part that played before the cut is appended (`release(limit)`), so the caller never hears
what a person who cut in would not have heard.

`RealtimeSpeech` is one caller response, streamed like `CallerSpeech`: its audio is buffered
until the runner attaches an utterance of the caller stream, then goes straight to it. It also
keeps the response's transcript and the `hang_up` call, if the model made one. A response may
have no audio (only a hang-up, or nothing at all).
"""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable

from voice_eval.ports.realtime_caller import (
    CallerAudio,
    CallerTranscript,
    HangUp,
    RealtimeCaller,
    RealtimeCallerError,
)
from voice_eval.runner.speech import CallerSpeech


class AgentAudioFeed:
    def __init__(self, caller: RealtimeCaller) -> None:
        self._caller = caller
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._pending = 0  # chunks queued or being appended
        self._held: bytearray | None = None
        self._task: asyncio.Task[None] | None = None
        self.failure: str | None = None

    @property
    def idle(self) -> bool:
        """Everything queued so far was appended (held audio is not queued)."""
        return self._pending == 0

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def push(self, pcm: bytes, *, hold: bool) -> None:
        """Agent audio as it arrives; `hold` keeps it until `release` (a turn to be cut)."""
        if hold:
            if self._held is None:
                self._held = bytearray()
            self._held += pcm
            return
        self.release()
        self._put(pcm)

    def release(self, limit: int | None = None) -> None:
        """Append the held audio: only its first `limit` bytes when the turn was cut."""
        held, self._held = self._held, None
        if held:
            self._put(bytes(held if limit is None else held[:limit]))

    def _put(self, pcm: bytes) -> None:
        if pcm:
            self._pending += 1
            self._queue.put_nowait(pcm)

    async def _run(self) -> None:
        while True:
            pcm = await self._queue.get()
            try:
                await self._caller.append(pcm)
            except RealtimeCallerError as exc:
                self.failure = f"realtime caller failed ({exc})"
                return
            except Exception as exc:  # never a provider payload: the type only
                self.failure = f"realtime caller failed ({type(exc).__name__})"
                return
            finally:
                self._pending -= 1


class RealtimeSpeech(CallerSpeech):
    failure_reason = "realtime_failed"
    label = "realtime caller"
    errors = (RealtimeCallerError,)
    needs_audio = False

    def __init__(
        self,
        caller: RealtimeCaller,
        note: str | None,
        *,
        decision_id: int,
        timeout_s: float,
        now_ms: Callable[[], float],
    ) -> None:
        self._caller = caller
        self._note = note
        self.decision_id = decision_id
        self.transcript: str | None = None
        self.hang_up: HangUp | None = None
        self._setup(timeout_s, now_ms, None)

    async def _chunks(self) -> AsyncIterator[bytes]:
        async with contextlib.aclosing(self._caller.respond(self._note)) as events:
            async for event in events:
                match event:
                    case CallerAudio(pcm=pcm):
                        yield pcm
                    case CallerTranscript(text=text):
                        self.transcript = text
                    case HangUp():
                        self.hang_up = event
