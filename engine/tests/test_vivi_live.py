from urllib.parse import parse_qs, urlsplit

import pytest

from voice_eval.targets.vivi_live import (
    AudioDelta,
    Closed,
    TranscriptStore,
    TranscriptUpdate,
    UnknownEvent,
    ViviLiveClient,
    parse_event,
)


def test_url_has_live_capability_and_fresh_thread_id():
    a = ViviLiveClient("wss://host.example/", "chan-1", "user-1")
    b = ViviLiveClient("wss://host.example", "chan-1", "user-1")
    parts = urlsplit(a.url)
    query = parse_qs(parts.query)
    assert parts.path == "/channelApi/chan-1/realtime"
    assert query["voiceCapability"] == ["live-v1"]
    assert query["userId"] == ["user-1"]
    assert query["threadId"] == [a.thread_id]
    assert a.thread_id != b.thread_id
    assert ViviLiveClient("wss://h", "c", "u", thread_id="t-1").thread_id == "t-1"


def test_parse_known_and_unknown_events():
    delta = parse_event({"type": "voice.audio.delta", "delta": "AAA="})
    assert isinstance(delta, AudioDelta) and delta.pcm == b"\x00\x00"
    closed = parse_event({"type": "voice.closed", "usageSeconds": 2.5, "finalUsageConfirmed": True})
    assert closed == Closed(usage_seconds=2.5, final_usage_confirmed=True, raw=closed.raw)
    unknown = parse_event({"type": "voice.something.new", "x": 1})
    assert isinstance(unknown, UnknownEvent) and unknown.type == "voice.something.new"


def test_transcript_store_replaces_cumulative_captions_and_orders_by_start():
    store = TranscriptStore()

    def upd(mid, role, text, start):
        return TranscriptUpdate(role=role, message_id=mid, text=text, start_ms=start, end_ms=start)

    assert store.update(upd("a1", "assistant", "Hola", 0))
    assert store.update(upd("a1", "assistant", "Hola, soy Vivi", 0))
    assert not store.update(upd("a1", "assistant", "Hola, soy Vivi", 0))
    assert store.update(upd("u1", "user", "quiero ayuda", 2000))
    assert store.update(upd("a2", "assistant", "claro", 1000))
    assert [(m.message_id, m.text) for m in store.messages()] == [
        ("a1", "Hola, soy Vivi"),
        ("a2", "claro"),
        ("u1", "quiero ayuda"),
    ]


@pytest.mark.parametrize("frame", [b"", b"\x00\x00\x00", b"\x00" * 100_000])
async def test_send_caller_audio_validates_limits(frame):
    client = ViviLiveClient("wss://h", "c", "u")
    with pytest.raises(ValueError):
        await client.send_caller_audio(frame)
