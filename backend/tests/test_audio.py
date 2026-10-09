import wave

import pytest

from voice_eval import audio


def test_chunk_pcm_splits_into_frames_and_pads_odd_tail():
    pcm = b"\x01" * (4800 * 2 + 101)
    frames = audio.chunk_pcm(pcm)
    assert [len(f) for f in frames] == [4800, 4800, 102]
    assert frames[-1].endswith(b"\x00")
    assert b"".join(frames)[: len(pcm)] == pcm


def test_chunk_pcm_never_emits_empty_frames():
    assert audio.chunk_pcm(b"") == []
    assert audio.chunk_pcm(b"\x00" * 4800) == [b"\x00" * 4800]


def test_chunk_pcm_rejects_odd_frame_size():
    with pytest.raises(ValueError):
        audio.chunk_pcm(b"\x00" * 10, frame_bytes=3)


def test_silence_duration_at_24k():
    assert len(audio.silence(100)) == audio.FRAME_BYTES
    assert audio.silence(1000) == b"\x00" * 48000


def test_b64_frame_stays_under_server_limit():
    encoded = audio.b64encode(b"\x7f" * audio.FRAME_BYTES)
    assert len(encoded) <= audio.MAX_B64_CHARS
    assert audio.b64decode(encoded) == b"\x7f" * audio.FRAME_BYTES


def test_wav_round_trip(tmp_path):
    pcm = bytes(range(256)) * 10
    path = tmp_path / "x.wav"
    audio.write_wav(path, pcm)
    assert audio.read_wav_pcm16_24k(path) == pcm


def test_read_wav_rejects_wrong_sample_rate(tmp_path):
    path = tmp_path / "bad.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 10)
    with pytest.raises(audio.AudioFormatError, match="24000"):
        audio.read_wav_pcm16_24k(path)


def test_read_wav_rejects_stereo(tmp_path):
    path = tmp_path / "stereo.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * 20)
    with pytest.raises(audio.AudioFormatError, match="mono"):
        audio.read_wav_pcm16_24k(path)
