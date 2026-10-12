"""The caller's words for one decision, synthesized as a stream in the background.

Synthesis starts as soon as the policy decides. Its chunks are buffered until the runner hands
the speech an utterance of the caller stream (`attach`), then go straight to it, so the caller
starts speaking on the first chunk instead of after the whole synthesis. A failure is kept as a
safe message (`failure`) for the runner to stop on; `cancel` drops a stale decision's stream.
"""

import asyncio
import contextlib
from collections.abc import Callable

from voice_eval.caller_stream import Utterance
from voice_eval.ports.tts import SpeechSynthesizer, SynthesisError


class CallerSpeech:
    def __init__(
        self,
        synthesizer: SpeechSynthesizer,
        text: str,
        *,
        timeout_s: float,
        now_ms: Callable[[], float],
        on_done: Callable[["CallerSpeech"], None] | None = None,
    ) -> None:
        self._synthesizer = synthesizer
        self._text = text
        self._timeout_s = timeout_s
        self._now_ms = now_ms
        self._on_done = on_done
        self._buffer: list[bytes] = []
        self._utterance: Utterance | None = None
        self.started_ms = now_ms()
        self.first_chunk_ms: float | None = None  # since `started_ms`
        self.total_ms: float | None = None  # since `started_ms`, set once the stream ended
        self.failure: str | None = None
        self._task = asyncio.create_task(self._pull())

    @property
    def has_audio(self) -> bool:
        return self.first_chunk_ms is not None

    @property
    def done(self) -> bool:
        return self._task.done()

    @property
    def attached(self) -> bool:
        return self._utterance is not None

    def attach(self, utterance: Utterance) -> None:
        """Speak through `utterance`: what was buffered now, the rest as it arrives."""
        self._utterance = utterance
        for chunk in self._buffer:
            utterance.feed(chunk)
        self._buffer.clear()
        if self.total_ms is not None and self.failure is None:
            utterance.finish()

    async def cancel(self) -> None:
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task

    async def _pull(self) -> None:
        try:
            async with asyncio.timeout(self._timeout_s):
                stream = self._synthesizer.stream(self._text)
                try:
                    async for chunk in stream:
                        self._take(chunk)
                finally:  # release the provider's request, also when cancelled
                    if (aclose := getattr(stream, "aclose", None)) is not None:
                        await aclose()
            if not self.has_audio:
                raise SynthesisError("no audio")
        except SynthesisError as exc:
            self.failure = f"speech synthesis failed ({exc})"
        except TimeoutError:
            self.failure = "speech synthesis timed out"
        except Exception as exc:  # provider errors may quote request details: type only
            self.failure = f"speech synthesis failed ({type(exc).__name__})"
        self.total_ms = self._now_ms() - self.started_ms
        if self.failure is not None:
            return
        if self._utterance is not None:
            self._utterance.finish()
        if self._on_done is not None:
            self._on_done(self)

    def _take(self, chunk: bytes) -> None:
        if not chunk:
            return
        if self.first_chunk_ms is None:
            self.first_chunk_ms = self._now_ms() - self.started_ms
        if self._utterance is not None:
            self._utterance.feed(chunk)
        else:
            self._buffer.append(chunk)
