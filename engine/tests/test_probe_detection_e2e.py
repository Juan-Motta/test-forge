"""Protocol detection failures: the probe stops fast, writes every artifact, sends nothing."""

import json
import time

from voice_eval.audio import FRAME_BYTES, write_wav
from voice_eval.probe import amain
from voice_eval.targets.detect import MAX_DETECT_FRAMES

ARTIFACTS = ("events.jsonl", "agent.wav", "caller.wav", "transcript.json", "summary.json")
READY_TIMEOUT_S = 5  # generous: every case below must fail well before it


def _args(url: str, out, *extra: str) -> list[str]:
    return [
        "--base-url",
        url,
        "--channel-id",
        "chan-test",
        "--user-id",
        "user-test",
        "--ready-timeout-s",
        str(READY_TIMEOUT_S),
        "--turn-timeout-s",
        "5",
        "--max-seconds",
        "20",
        "--out",
        str(out),
        *extra,
    ]


async def _run(url: str, out, *extra: str) -> tuple[int, dict, float]:
    started = time.monotonic()
    code = await amain(_args(url, out, *extra))
    elapsed = time.monotonic() - started
    for name in ARTIFACTS:
        assert (out / name).is_file(), name
    return code, json.loads((out / "summary.json").read_text()), elapsed


def _assert_stopped(summary: dict, *needles: str) -> None:
    assert summary["complete"] is False
    assert summary["protocol"] is None
    assert summary["agent_turns"] == 0
    assert any(all(n in w for n in needles) for w in summary["warnings"]), summary["warnings"]


async def test_socket_closed_before_protocol_identified(scripted_server, tmp_path):
    server = await scripted_server([json.dumps({"type": "hello"})], close_code=1011)
    code, summary, elapsed = await _run(server.url, tmp_path / "run", "--text", "hi")

    assert code == 1
    _assert_stopped(summary, "socket closed before the protocol was identified")
    assert elapsed < READY_TIMEOUT_S
    assert server.received == []


async def test_unrecognized_frames_stop_detection(scripted_server, tmp_path):
    frames = [json.dumps({"type": f"mystery.{i}"}) for i in range(MAX_DETECT_FRAMES)]
    server = await scripted_server(frames)
    code, summary, elapsed = await _run(server.url, tmp_path / "run", "--text", "hi")

    assert code == 1
    _assert_stopped(summary, "unrecognized protocol", "mystery.0")
    assert elapsed < READY_TIMEOUT_S
    assert server.received == []


async def test_detection_times_out_on_a_silent_server(scripted_server, tmp_path):
    server = await scripted_server([])
    started = time.monotonic()
    code = await amain(
        [*_args(server.url, tmp_path / "run", "--text", "hi"), "--ready-timeout-s", "0.3"]
    )
    elapsed = time.monotonic() - started

    assert code == 1
    summary = json.loads((tmp_path / "run" / "summary.json").read_text())
    _assert_stopped(summary, "no protocol-identifying frame received in time")
    assert elapsed < 3
    assert server.received == []


async def test_forced_live_against_legacy_server_fails_fast(fake_realtime_server, tmp_path):
    wav = tmp_path / "caller.wav"
    write_wav(wav, b"\x30\x00" * FRAME_BYTES)
    out = tmp_path / "run"
    code, summary, elapsed = await _run(
        fake_realtime_server.url, out, "--protocol", "live", "--caller-wav", str(wav)
    )

    assert code == 1
    _assert_stopped(summary, "--protocol live", "realtime")
    assert elapsed < 2
    assert fake_realtime_server.received_types == []  # no voice.* event reached the relay
    assert fake_realtime_server.protocol_violations == []


async def test_forced_realtime_against_live_server_fails_fast(fake_live_server, tmp_path):
    code, summary, elapsed = await _run(
        fake_live_server.url, tmp_path / "run", "--protocol", "realtime", "--text", "hi"
    )

    assert code == 1
    _assert_stopped(summary, "--protocol realtime", "live")
    assert elapsed < 2
    assert fake_live_server.received_types == []
    assert fake_live_server.protocol_violations == []
