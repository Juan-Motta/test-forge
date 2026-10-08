import json

from voice_eval.audio import FRAME_BYTES, write_wav
from voice_eval.probe import amain


class FakeSynthesizer:
    def __init__(self) -> None:
        self.texts: list[str] = []

    async def synthesize(self, text: str) -> bytes:
        self.texts.append(text)
        return b"\x20\x00" * (FRAME_BYTES * 3 // 2)


async def test_probe_holds_a_conversation_with_fake_server(fake_live_server, tmp_path):
    out = tmp_path / "run"
    caller_wav = tmp_path / "caller.wav"
    write_wav(caller_wav, b"\x30\x00" * (FRAME_BYTES * 3 // 2))
    synth = FakeSynthesizer()

    code = await amain(
        [
            "--base-url",
            fake_live_server.url,
            "--channel-id",
            "chan-test",
            "--user-id",
            "user-test",
            "--origin",
            "https://origin.test",
            "--say",
            "first question",
            "--caller-wav",
            str(caller_wav),
            "--silence-gap-ms",
            "300",
            "--turn-timeout-s",
            "10",
            "--max-seconds",
            "30",
            "--out",
            str(out),
        ],
        synthesizer=synth,
    )

    assert code == 0
    assert synth.texts == ["first question"]
    assert fake_live_server.protocol_violations == []
    assert set(fake_live_server.received_types) == {"voice.input.audio", "voice.close"}
    assert fake_live_server.origins == ["https://origin.test"]
    for name in ("events.jsonl", "agent.wav", "caller.wav", "transcript.json", "summary.json"):
        assert (out / name).is_file(), name

    transcript = json.loads((out / "transcript.json").read_text())
    assert {m["role"] for m in transcript} == {"user", "assistant"}
    assert any(m["text"] == "hello I am the fake agent" for m in transcript)

    summary = json.loads((out / "summary.json").read_text())
    assert summary["session_id"] == "sess-fake"
    assert summary["langfuse_session_id"] == summary["thread_id"]
    assert summary["caller_turns"] == 2
    assert summary["agent_turns"] == 3
    assert len(summary["latencies_ms"]) == 2
    assert all(lat > 0 for lat in summary["latencies_ms"])
    assert summary["close_code"] == 1000
    assert summary["final_usage_confirmed"] is True

    events = [json.loads(line) for line in (out / "events.jsonl").read_text().splitlines()]
    deltas = [e for e in events if e["type"] == "voice.audio.delta"]
    assert deltas and all("delta" not in e and e["bytes"] == 4800 for e in deltas)
