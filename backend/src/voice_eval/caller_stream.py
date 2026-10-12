"""Real-time caller audio stream.

The target runs its own VAD on the input, so the caller must behave like an open microphone:
one 100 ms frame per 100 ms of wall time, carrying queued speech or silence when idle.
"""

import asyncio
from collections import deque
from collections.abc import Awaitable, Callable

from voice_eval.audio import FRAME_BYTES, FRAME_MS, chunk_pcm, silence

SendFrame = Callable[[bytes], Awaitable[None]]
SpeechEndCallback = Callable[[float], None]

_SILENT_FRAME = silence(FRAME_MS)
_MAX_LAG_S = 1.0


class Utterance:
    """One queued utterance; its speech may still be arriving (`feed`) until `finish`.

    Speech is cut into the same 100 ms frames as a whole utterance would be, so feeding it in
    pieces sends exactly the same bytes. The trailing silence is queued on `finish`.
    """

    def __init__(
        self,
        trailing_silence_ms: int,
        on_speech_end: SpeechEndCallback | None,
        on_speech_start: SpeechEndCallback | None,
        wake: asyncio.Event,
    ) -> None:
        self._trailing_silence_ms = trailing_silence_ms
        self._on_speech_end = on_speech_end
        self._on_speech_start = on_speech_start
        self._wake = wake
        self._frames: deque[tuple[bytes, SpeechEndCallback | None]] = deque()
        self._pending = bytearray()
        self._speech_frames = 0
        self._last_sent_ms: float | None = None
        self._in_flight = False  # a speech frame was taken and is being sent
        self._end_after_in_flight = False
        self.finished = False

    @property
    def drained(self) -> bool:
        """Every frame was sent and no more will come."""
        return self.finished and not self._frames

    def feed(self, pcm: bytes) -> None:
        """Add speech; every complete frame becomes ready to send."""
        if self.finished:
            raise ValueError("the utterance is already finished")
        self._pending += pcm
        while len(self._pending) >= FRAME_BYTES:
            self._push(bytes(self._pending[:FRAME_BYTES]))
            del self._pending[:FRAME_BYTES]

    def finish(self) -> None:
        """No more speech: queue the last partial frame and the trailing silence."""
        if self.finished:
            return
        if self._pending:
            self._push(chunk_pcm(bytes(self._pending))[0])
            self._pending.clear()
        if not self._speech_frames:
            raise ValueError("cannot enqueue an empty utterance")
        self.finished = True
        if self._frames:
            frame, on_sent = self._frames[-1]
            self._frames[-1] = (frame, _both(on_sent, self._on_speech_end))
        elif self._in_flight:
            self._end_after_in_flight = True  # the last word is on its way
        elif self._on_speech_end is not None:
            # every word was already sent while the rest was awaited: it ended with the last one
            assert self._last_sent_ms is not None
            self._on_speech_end(self._last_sent_ms)
        self._frames.extend(
            (frame, None) for frame in chunk_pcm(silence(self._trailing_silence_ms))
        )
        self._wake.set()

    def _push(self, frame: bytes) -> None:
        on_sent = self._on_speech_start if not self._speech_frames else None
        self._speech_frames += 1
        self._frames.append((frame, on_sent))
        self._wake.set()

    def _pop(self) -> tuple[bytes, SpeechEndCallback | None] | None:
        if not self._frames:
            return None
        self._in_flight = True
        return self._frames.popleft()

    def _sent(self, now_ms: float) -> None:
        self._in_flight = False
        self._last_sent_ms = now_ms
        if self._end_after_in_flight:
            self._end_after_in_flight = False
            if self._on_speech_end is not None:
                self._on_speech_end(now_ms)


class CallerAudioStream:
    def __init__(self, send: SendFrame, now_ms: Callable[[], float]) -> None:
        self._send = send
        self._now_ms = now_ms
        self._queue: deque[Utterance] = deque()
        self._wake = asyncio.Event()
        self.sent = bytearray()

    @property
    def idle(self) -> bool:
        return not self._queue

    def open(
        self,
        trailing_silence_ms: int = 600,
        on_speech_end: SpeechEndCallback | None = None,
        on_speech_start: SpeechEndCallback | None = None,
    ) -> Utterance:
        """Queue an utterance whose speech is fed while it is synthesized."""
        utterance = Utterance(trailing_silence_ms, on_speech_end, on_speech_start, self._wake)
        self._queue.append(utterance)
        return utterance

    def enqueue(
        self,
        pcm: bytes,
        trailing_silence_ms: int = 600,
        on_speech_end: SpeechEndCallback | None = None,
        on_speech_start: SpeechEndCallback | None = None,
    ) -> None:
        """Queue an utterance; the callbacks fire when its first / last speech frame is sent."""
        if not pcm:
            raise ValueError("cannot enqueue an empty utterance")
        utterance = self.open(trailing_silence_ms, on_speech_end, on_speech_start)
        utterance.feed(pcm)
        utterance.finish()

    def _next(self) -> tuple[Utterance | None, bytes, SpeechEndCallback | None] | None:
        """The next frame to send; None while the current utterance waits for its speech."""
        while self._queue:
            utterance = self._queue[0]
            if (entry := utterance._pop()) is not None:
                return utterance, *entry
            if not utterance.finished:
                return None
            self._queue.popleft()
        return None, _SILENT_FRAME, None

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        period = FRAME_MS / 1000
        next_tick = loop.time()
        while True:
            entry = self._next()
            if entry is None:
                # Synthesis is behind real time: send nothing rather than slip silence into the
                # middle of the words, and resume on the beat as soon as more speech arrives.
                self._wake.clear()
                await self._wake.wait()
                next_tick = max(next_tick, loop.time())
                continue
            utterance, frame, on_sent = entry
            await self._send(frame)
            self.sent += frame
            now_ms = self._now_ms()
            if on_sent is not None:
                on_sent(now_ms)
            if utterance is not None:
                utterance._sent(now_ms)  # after `on_sent`: a pending end follows the start
            next_tick += period
            delay = next_tick - loop.time()
            if delay < -_MAX_LAG_S:
                next_tick = loop.time()  # fell far behind: resync instead of bursting
            elif delay > 0:
                await asyncio.sleep(delay)


def _both(
    first: SpeechEndCallback | None, second: SpeechEndCallback | None
) -> SpeechEndCallback | None:
    if first is None or second is None:
        return first or second

    def call(now_ms: float) -> None:
        first(now_ms)
        second(now_ms)

    return call
