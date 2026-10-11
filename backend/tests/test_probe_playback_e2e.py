"""The simulated caller waits for the agent's audio to finish playing before speaking again.

The fakes deliver each agent turn as one burst of audio (much faster than real time), like
real agents do. Timings are compared on the server side, on the shared monotonic clock.
"""

import json

import pytest

from voice_eval.audio import FRAME_BYTES, write_wav
from voice_eval.probe import CallerTurn, ProbeOptions, ProbeRun, amain
from voice_eval.targets.detect import TargetSpec

BURST_MS = 2000
GRACE_MS = 100
TOLERANCE_S = 0.05


def _args(url: str, out, *extra: str) -> list[str]:
    return [
        "--base-url",
        url,
        "--channel-id",
        "chan-test",
        "--user-id",
        "user-test",
        "--settle-ms",
        "300",
        "--silence-gap-ms",
        "300",
        "--turn-timeout-s",
        "10",
        "--max-seconds",
        "30",
        "--playback-grace-ms",
        str(GRACE_MS),
        "--out",
        str(out),
        *extra,
    ]


def _summary(out) -> dict:
    return json.loads((out / "summary.json").read_text())


def _assert_turn_playback_fields(turn: dict) -> None:
    expected = turn["first_audio_ms"] + turn["audio_ms"]
    assert turn["playback_end_ms"] == pytest.approx(expected, abs=0.2)


@pytest.mark.parametrize("wait", [True, False], ids=["playback-wait", "no-playback-wait"])
async def test_legacy_caller_waits_for_agent_playback(fake_realtime_server, tmp_path, wait):
    fake_realtime_server.burst_audio_ms = BURST_MS
    out = tmp_path / "run"
    extra = [] if wait else ["--no-playback-wait"]

    code = await amain(
        _args(fake_realtime_server.url, out, "--text", "one", "--text", "two", *extra)
    )

    assert code == 0
    gap_s = (
        fake_realtime_server.caller_text_received[1] - fake_realtime_server.agent_audio_started[0]
    )
    if wait:
        assert gap_s >= (BURST_MS + GRACE_MS) / 1000 - TOLERANCE_S
    else:
        assert gap_s < BURST_MS / 1000 / 2  # right after the turn end (settle 300 ms)

    summary = _summary(out)
    assert summary["playback_wait"] is wait
    assert summary["playback_grace_ms"] == GRACE_MS
    first, second = summary["turns"]
    assert first["audio_ms"] == BURST_MS
    for turn in (first, second):
        _assert_turn_playback_fields(turn)
    assert second["caller_resumed_ms"] is None  # no caller turn after the last reply
    if wait:
        assert first["caller_resumed_ms"] >= first["playback_end_ms"] + GRACE_MS
    else:
        assert first["caller_resumed_ms"] < first["playback_end_ms"]
    assert first["caller_resumed_ms"] >= first["end_ms"]


@pytest.mark.parametrize("wait", [True, False], ids=["playback-wait", "no-playback-wait"])
async def test_live_caller_waits_for_greeting_playback(fake_live_server, tmp_path, wait):
    fake_live_server.burst_audio_ms = BURST_MS
    out = tmp_path / "run"
    caller_wav = tmp_path / "caller.wav"
    write_wav(caller_wav, b"\x30\x00" * (FRAME_BYTES * 3 // 2))
    extra = [] if wait else ["--no-playback-wait"]

    code = await amain(_args(fake_live_server.url, out, "--caller-wav", str(caller_wav), *extra))

    assert code == 0
    assert fake_live_server.protocol_violations == []
    gap_s = fake_live_server.caller_speech_started[0] - fake_live_server.agent_audio_started[0]
    if wait:
        assert gap_s >= (BURST_MS + GRACE_MS) / 1000 - TOLERANCE_S
    else:
        assert gap_s < BURST_MS / 1000 / 2  # right after the 300 ms audio gap

    summary = _summary(out)
    assert summary["playback_wait"] is wait
    greeting, reply = summary["turns"]
    assert greeting["kind"] == "greeting" and reply["kind"] == "reply"
    for turn in (greeting, reply):
        _assert_turn_playback_fields(turn)
    if wait:
        assert greeting["caller_resumed_ms"] >= greeting["playback_end_ms"] + GRACE_MS
    else:
        assert greeting["caller_resumed_ms"] < greeting["playback_end_ms"]
    # the latency definition is unchanged: last caller speech frame -> first agent audio
    expected_latency = reply["first_audio_ms"] - reply["caller_end_ms"]
    assert reply["latency_ms"] == pytest.approx(expected_latency, abs=0.2)  # fields are rounded


async def test_playback_wait_is_bounded_by_max_seconds(fake_realtime_server, tmp_path):
    fake_realtime_server.burst_audio_ms = 20000
    out = tmp_path / "run"
    options = ProbeOptions(settle_ms=300, turn_timeout_s=30, max_seconds=2, close_timeout_s=2)
    probe = ProbeRun(TargetSpec(fake_realtime_server.url, "chan", "user"), out, options)

    summary = await probe.run([CallerTurn(text="one"), CallerTurn(text="two")])

    assert summary["complete"] is False
    assert any("max run time" in w and "playback" in w for w in summary["warnings"])
    assert summary["duration_ms"] < 4000
    assert len(fake_realtime_server.caller_text_received) == 1
    assert summary["turns"][0]["caller_resumed_ms"] is None


async def test_playback_wait_is_bounded_by_the_turn_timeout(fake_realtime_server, tmp_path):
    fake_realtime_server.burst_audio_ms = 20000
    out = tmp_path / "run"
    options = ProbeOptions(settle_ms=300, turn_timeout_s=1, max_seconds=15)
    probe = ProbeRun(TargetSpec(fake_realtime_server.url, "chan", "user"), out, options)

    summary = await probe.run([CallerTurn(text="one"), CallerTurn(text="two")])

    assert any("playback" in w and "timed out" in w for w in summary["warnings"])
    assert len(fake_realtime_server.caller_text_received) == 2
    first = summary["turns"][0]
    assert first["end_ms"] < first["caller_resumed_ms"] < first["playback_end_ms"]
    assert first["caller_resumed_ms"] - first["end_ms"] >= 1000 - 60


@pytest.mark.parametrize("wait", [True, False], ids=["playback-wait", "no-playback-wait"])
async def test_the_probe_hangs_up_after_the_last_reply_played(fake_realtime_server, tmp_path, wait):
    fake_realtime_server.burst_audio_ms = BURST_MS
    options = ProbeOptions(settle_ms=300, playback_grace_ms=GRACE_MS, playback_wait=wait)
    probe = ProbeRun(TargetSpec(fake_realtime_server.url, "chan", "user"), tmp_path, options)

    summary = await probe.run([CallerTurn(text="one")])

    assert summary["complete"] is True
    (reply,) = summary["turns"]
    sent = [e for e in probe.events if e["dir"] == "out" and e.get("type") != "caller.text"]
    hang_up_ms = sent[-1]["t_ms"]  # what the adapter sent to close the session
    if wait:
        assert hang_up_ms >= reply["playback_end_ms"] + GRACE_MS - 1
    else:
        assert hang_up_ms < reply["playback_end_ms"]


async def test_max_seconds_during_the_last_playback_is_only_a_warning(
    fake_realtime_server, tmp_path
):
    fake_realtime_server.burst_audio_ms = 20000
    options = ProbeOptions(settle_ms=300, turn_timeout_s=30, max_seconds=2, close_timeout_s=2)
    probe = ProbeRun(TargetSpec(fake_realtime_server.url, "chan", "user"), tmp_path, options)

    summary = await probe.run([CallerTurn(text="one")])

    assert summary["complete"] is True  # every turn happened; only the listening was cut short
    assert any("max run time" in w and "hanging up" in w for w in summary["warnings"])
    assert summary["duration_ms"] < 4000
