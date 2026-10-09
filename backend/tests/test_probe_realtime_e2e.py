import asyncio
import json

import pytest

from voice_eval.audio import FRAME_BYTES, write_wav
from voice_eval.probe import CallerTurn, ProbeOptions, ProbeRun, amain
from voice_eval.targets.detect import TargetSpec


def _args(url: str, out, *extra: str) -> list[str]:
    return [
        "--base-url",
        url,
        "--channel-id",
        "chan-test",
        "--user-id",
        "user-test",
        "--settle-ms",
        "500",
        "--turn-timeout-s",
        "10",
        "--max-seconds",
        "30",
        "--out",
        str(out),
        *extra,
    ]


def _read(out, name):
    return json.loads((out / name).read_text())


async def test_legacy_text_tool_and_audio_turns_end_to_end(fake_realtime_server, tmp_path):
    out = tmp_path / "run"
    caller_wav = tmp_path / "caller.wav"
    write_wav(caller_wav, b"\x30\x00" * (FRAME_BYTES * 3 // 2))

    code = await amain(
        _args(
            fake_realtime_server.url,
            out,
            "--text",
            "hello there",
            "--text",
            "please use the tool",
            "--caller-wav",
            str(caller_wav),
        )
    )

    assert code == 0
    await asyncio.wait_for(fake_realtime_server.closed.wait(), 2)
    assert fake_realtime_server.protocol_violations == []
    assert set(fake_realtime_server.received_types) <= fake_realtime_server.allowed_types
    assert not any(t.startswith("voice.") for t in fake_realtime_server.received_types)
    assert fake_realtime_server.client_close_codes == [1000]
    for name in ("events.jsonl", "agent.wav", "caller.wav", "transcript.json", "summary.json"):
        assert (out / name).is_file(), name

    summary = _read(out, "summary.json")
    assert summary["protocol"] == "realtime"
    assert summary["model"] == "gpt-realtime-2.1"
    assert summary["session_id"] == "sess_rt"
    assert summary["langfuse_session_id"] == summary["thread_id"]
    assert summary["close_code"] == 1000
    assert summary["caller_turns"] == 3
    assert summary["agent_turns"] == 3  # no greeting: the caller starts on this path
    assert summary["complete"] is True
    turns = summary["turns"]
    assert [t["kind"] for t in turns] == ["reply", "reply", "reply"]
    assert [t["response_count"] for t in turns] == [1, 2, 1]
    assert [t["tool_activity"] for t in turns] == [False, True, False]
    assert all(t["end_reason"] == "response_done" for t in turns)
    assert len(summary["latencies_ms"]) == 3 and all(v > 0 for v in summary["latencies_ms"])

    transcript = _read(out, "transcript.json")
    assert [(m["role"], m["text"]) for m in transcript] == [
        ("user", "hello there"),
        ("assistant", "agent response number 1"),
        ("user", "please use the tool"),
        ("assistant", "agent response number 3"),
        ("user", "caller audio turn 1"),
        ("assistant", "agent response number 4"),
    ]

    events = [json.loads(line) for line in (out / "events.jsonl").read_text().splitlines()]
    deltas = [e for e in events if e["type"] == "response.output_audio.delta"]
    assert deltas and all("delta" not in e and e["bytes"] == 4800 for e in deltas)
    sent = [e for e in events if e.get("dir") == "out"]
    assert [e["type"] for e in sent] == ["caller.text", "caller.text", "websocket.close"]


async def test_legacy_agent_first_requests_an_opening_turn(fake_realtime_server, tmp_path):
    out = tmp_path / "run"
    code = await amain(_args(fake_realtime_server.url, out, "--agent-first", "--text", "hi"))

    assert code == 0
    summary = _read(out, "summary.json")
    assert [t["kind"] for t in summary["turns"]] == ["greeting", "reply"]
    assert fake_realtime_server.received_types.count("response.create") == 2
    assert fake_realtime_server.protocol_violations == []


async def test_text_turn_on_live_target_fails_clearly(fake_live_server, tmp_path, capsys):
    out = tmp_path / "run"
    code = await amain(_args(fake_live_server.url, out, "--text", "hello"))

    assert code == 1
    summary = _read(out, "summary.json")
    assert summary["protocol"] == "live"
    assert any("--text" in w and "live" in w for w in summary["warnings"])
    assert "voice.input.audio" not in fake_live_server.received_types
    assert fake_live_server.protocol_violations == []
    assert "--text" in capsys.readouterr().out


async def test_text_turn_with_explicit_live_protocol_is_rejected_before_connecting(
    fake_live_server, tmp_path, capsys
):
    code = await amain(
        _args(fake_live_server.url, tmp_path / "run", "--protocol", "live", "--text", "hello")
    )

    assert code == 2
    assert fake_live_server.paths == []
    assert "--text" in capsys.readouterr().err


class RecordingSynthesizer:
    def __init__(self) -> None:
        self.texts: list[str] = []

    async def synthesize(self, text: str) -> bytes:
        self.texts.append(text)
        return b"\x20\x00" * FRAME_BYTES


@pytest.mark.parametrize(
    ("flag", "value"),
    [("--text", ""), ("--text", "   "), ("--say", "\t\n"), ("--say", "")],
)
async def test_blank_caller_turn_is_rejected_before_connecting(
    fake_realtime_server, tmp_path, capsys, flag, value
):
    synth = RecordingSynthesizer()
    out = tmp_path / "run"
    code = await amain(
        _args(fake_realtime_server.url, out, "--text", "fine", flag, value), synthesizer=synth
    )

    assert code == 2
    assert fake_realtime_server.paths == []  # no connection attempted
    assert synth.texts == []  # nothing synthesized either
    assert not out.exists()
    err = capsys.readouterr().err
    assert flag in err and "empty" in err


async def test_probe_stops_cleanly_when_the_target_rejects_a_caller_turn(
    fake_realtime_server, tmp_path
):
    out = tmp_path / "run"
    spec = TargetSpec(fake_realtime_server.url, "chan", "user")
    probe = ProbeRun(spec, out, ProbeOptions(settle_ms=300, turn_timeout_s=5, max_seconds=10))

    summary = await probe.run([CallerTurn(text="hello"), CallerTurn(text="   ")])

    assert summary["complete"] is False
    assert any("caller turn 2" in w and "empty" in w for w in summary["warnings"])
    for name in ("events.jsonl", "agent.wav", "caller.wav", "transcript.json", "summary.json"):
        assert (out / name).is_file(), name
    events = [json.loads(line) for line in (out / "events.jsonl").read_text().splitlines()]
    sent = [e for e in events if e.get("dir") == "out"]
    assert [(e["type"], e.get("text")) for e in sent] == [
        ("caller.text", "hello"),
        ("websocket.close", None),
    ]
    await asyncio.wait_for(fake_realtime_server.closed.wait(), 2)
    assert fake_realtime_server.received_types.count("conversation.item.create") == 1
    assert fake_realtime_server.protocol_violations == []
    assert fake_realtime_server.client_close_codes == [1000]
