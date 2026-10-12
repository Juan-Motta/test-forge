"""The open-microphone caller stream: utterances queued whole or fed while they are synthesized."""

import asyncio

import pytest

from voice_eval.audio import FRAME_BYTES, chunk_pcm, silence
from voice_eval.caller_stream import CallerAudioStream

SPEECH = bytes(range(1, 201)) * 61  # 12,200 bytes: two full frames and a partial one
TRAILING_MS = 200


class Recorder:
    def __init__(self) -> None:
        self.frames: list[bytes] = []
        self.clock = 0.0

    async def send(self, frame: bytes) -> None:
        self.frames.append(frame)

    def now_ms(self) -> float:
        return self.clock


def expected_frames(pcm: bytes) -> list[bytes]:
    return [*chunk_pcm(pcm, FRAME_BYTES), *chunk_pcm(silence(TRAILING_MS))]


async def eventually(done, timeout_s: float = 3) -> None:
    for _ in range(int(timeout_s / 0.01)):
        if done():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition not reached in time")


async def run_until(stream: CallerAudioStream, done, timeout_s: float = 3) -> None:
    sender = asyncio.create_task(stream.run())
    try:
        await eventually(done, timeout_s)
    finally:
        sender.cancel()
        with pytest.raises(asyncio.CancelledError):
            await sender


def speech_of(frames: list[bytes]) -> list[bytes]:
    return [frame for frame in frames if any(frame)]


async def test_an_utterance_fed_in_pieces_sends_the_same_frames_as_a_whole_one():
    whole, fed = Recorder(), Recorder()
    events: list[str] = []
    a = CallerAudioStream(whole.send, whole.now_ms)
    a.enqueue(SPEECH, TRAILING_MS)
    b = CallerAudioStream(fed.send, fed.now_ms)
    utterance = b.open(
        TRAILING_MS,
        on_speech_end=lambda t: events.append("end"),
        on_speech_start=lambda t: events.append("start"),
    )
    for start in range(0, len(SPEECH), 3001):  # odd-sized pieces across frame boundaries
        utterance.feed(SPEECH[start : start + 3001])
    utterance.finish()

    await run_until(a, lambda: a.idle)
    await run_until(b, lambda: b.idle)

    assert speech_of(fed.frames) == speech_of(whole.frames) == chunk_pcm(SPEECH)
    assert bytes(b.sent).strip(b"\x00") == bytes(a.sent).strip(b"\x00")
    assert events == ["start", "end"]


async def test_the_first_frame_goes_out_before_the_utterance_is_complete():
    rec = Recorder()
    stream = CallerAudioStream(rec.send, rec.now_ms)
    started: list[float] = []
    utterance = stream.open(TRAILING_MS, on_speech_start=started.append)
    utterance.feed(SPEECH[:FRAME_BYTES])

    await run_until(stream, lambda: bool(started))

    assert speech_of(rec.frames) == [SPEECH[:FRAME_BYTES]]
    assert not stream.idle  # still open: more speech may come


async def test_a_starved_utterance_sends_nothing_until_more_audio_arrives():
    rec = Recorder()
    stream = CallerAudioStream(rec.send, rec.now_ms)
    ended: list[float] = []
    utterance = stream.open(TRAILING_MS, on_speech_end=ended.append)
    utterance.feed(SPEECH[:FRAME_BYTES])
    sender = asyncio.create_task(stream.run())
    await asyncio.sleep(0.35)  # several frame periods with no new audio
    sent_while_starved = list(rec.frames)
    rec.clock = 1234.0
    utterance.feed(SPEECH[FRAME_BYTES:])
    utterance.finish()
    try:
        await eventually(lambda: stream.idle)
    finally:
        sender.cancel()
        with pytest.raises(asyncio.CancelledError):
            await sender

    # no silence was slipped into the middle of the words
    assert sent_while_starved == [SPEECH[:FRAME_BYTES]]
    assert rec.frames[: len(expected_frames(SPEECH))] == expected_frames(SPEECH)
    assert ended == [1234.0]


async def test_finishing_after_every_frame_was_sent_reports_the_last_frame_time():
    rec = Recorder()
    stream = CallerAudioStream(rec.send, rec.now_ms)
    ended: list[float] = []
    utterance = stream.open(TRAILING_MS, on_speech_end=ended.append)
    rec.clock = 500.0
    utterance.feed(SPEECH[: FRAME_BYTES * 2])
    await run_until(stream, lambda: len(rec.frames) >= 2)
    rec.clock = 9000.0  # the provider reports the end of the stream much later

    utterance.finish()

    assert ended == [500.0]
    assert speech_of(rec.frames) == chunk_pcm(SPEECH[: FRAME_BYTES * 2])
    assert not stream.idle  # the trailing silence is still queued


def test_an_empty_utterance_is_rejected():
    stream = CallerAudioStream(Recorder().send, lambda: 0.0)
    with pytest.raises(ValueError):
        stream.enqueue(b"")
    with pytest.raises(ValueError):
        stream.open().finish()


async def test_finishing_while_the_last_frame_is_being_sent_ends_once_it_is_sent():
    gate = asyncio.Event()
    clock = [100.0]
    calls: list[tuple[str, float]] = []

    async def slow_send(frame: bytes) -> None:
        await gate.wait()
        clock[0] = 700.0

    stream = CallerAudioStream(slow_send, lambda: clock[0])
    utterance = stream.open(
        TRAILING_MS,
        on_speech_end=lambda t: calls.append(("end", t)),
        on_speech_start=lambda t: calls.append(("start", t)),
    )
    utterance.feed(SPEECH[:FRAME_BYTES])
    sender = asyncio.create_task(stream.run())
    await asyncio.sleep(0.02)  # the only frame is in flight
    utterance.finish()
    assert calls == []
    gate.set()
    await asyncio.sleep(0.02)
    sender.cancel()
    with pytest.raises(asyncio.CancelledError):
        await sender

    assert calls == [("start", 700.0), ("end", 700.0)]
