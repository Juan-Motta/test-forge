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


class CallerAudioStream:
    def __init__(self, send: SendFrame, now_ms: Callable[[], float]) -> None:
        self._send = send
        self._now_ms = now_ms
        self._queue: deque[tuple[bytes, SpeechEndCallback | None]] = deque()
        self.sent = bytearray()

    @property
    def idle(self) -> bool:
        return not self._queue

    def enqueue(
        self,
        pcm: bytes,
        trailing_silence_ms: int = 600,
        on_speech_end: SpeechEndCallback | None = None,
    ) -> None:
        """Queue an utterance; `on_speech_end` fires when its last speech frame is sent."""
        frames = chunk_pcm(pcm, FRAME_BYTES)
        if not frames:
            raise ValueError("cannot enqueue an empty utterance")
        self._queue.extend((frame, None) for frame in frames[:-1])
        self._queue.append((frames[-1], on_speech_end))
        self._queue.extend((frame, None) for frame in chunk_pcm(silence(trailing_silence_ms)))

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        period = FRAME_MS / 1000
        next_tick = loop.time()
        while True:
            frame, on_sent = self._queue.popleft() if self._queue else (_SILENT_FRAME, None)
            await self._send(frame)
            self.sent += frame
            if on_sent is not None:
                on_sent(self._now_ms())
            next_tick += period
            delay = next_tick - loop.time()
            if delay < -_MAX_LAG_S:
                next_tick = loop.time()  # fell far behind: resync instead of bursting
            elif delay > 0:
                await asyncio.sleep(delay)
