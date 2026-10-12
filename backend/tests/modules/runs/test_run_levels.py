"""Audio levels of a run: both channels placed on the run timeline from `events.jsonl`.

The WAV artifacts are not aligned: `agent.wav` holds only the audio the agent sent, back to
back, and `caller.wav` holds every frame of the open microphone, silence included. The audio
events say when each chunk arrived (agent) or was sent (caller).
"""

import json
import math
import struct
import uuid
from pathlib import Path

import pytest
from runs_support import insert_run

from voice_eval.audio import BYTES_PER_MS, FRAME_BYTES, write_wav
from voice_eval.modules.runs.levels import build_levels


def tone(ms: int, amplitude: int) -> bytes:
    """A square wave: every sample is +/- `amplitude`, so its RMS is exactly `amplitude`."""
    samples = ms * BYTES_PER_MS // 2
    values = (amplitude if i % 2 else -amplitude for i in range(samples))
    return struct.pack(f"<{samples}h", *values)


def quiet(ms: int) -> bytes:
    return b"\x00" * (ms * BYTES_PER_MS)


def write_run(
    out: Path,
    *,
    events: list[dict] | None,
    agent: bytes = b"",
    caller: bytes = b"",
    duration_ms: float = 2000.0,
    transcript: list[dict] | None = None,
) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    if events is not None:
        (out / "events.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
    write_wav(out / "agent.wav", agent)
    write_wav(out / "caller.wav", caller)
    (out / "summary.json").write_text(json.dumps({"duration_ms": duration_ms}))
    (out / "transcript.json").write_text(json.dumps(transcript or []))
    return out


def agent_audio(t_ms: float, ms: int, chunk: int = 1) -> dict:
    return {"type": "agent_audio", "t_ms": t_ms, "chunk": chunk, "bytes": ms * BYTES_PER_MS}


def caller_audio(t_ms: float, ms: int, chunk: int = 1) -> dict:
    return {"type": "caller_audio", "t_ms": t_ms, "chunk": chunk, "bytes": ms * BYTES_PER_MS}


def test_agent_chunks_play_back_to_back_from_their_arrival(tmp_path):
    # Two 100 ms chunks arrive together at 500 ms: they play from 500 to 700 ms.
    out = write_run(
        tmp_path,
        events=[agent_audio(500, 100, 1), agent_audio(500, 100, 2)],
        agent=tone(200, 16000),
    )
    levels = build_levels(out, bins=20)
    assert levels.duration_ms == 2000
    assert len(levels.agent) == len(levels.caller) == 20
    assert [i for i, v in enumerate(levels.agent) if v > 0] == [5, 6]
    assert levels.agent[5] == levels.agent[6] == 1.0
    assert levels.caller == [0.0] * 20


def test_a_late_chunk_starts_when_it_arrives(tmp_path):
    out = write_run(
        tmp_path,
        events=[agent_audio(0, 100, 1), agent_audio(1000, 100, 2)],
        agent=tone(100, 16000) + tone(100, 8000),
    )
    levels = build_levels(out, bins=20)
    assert [i for i, v in enumerate(levels.agent) if v > 0] == [0, 10]
    assert levels.agent[10] == pytest.approx(0.5)


def test_caller_speech_frames_skip_the_silence_of_the_open_microphone(tmp_path):
    # caller.wav: two silent frames, one speech frame (sent at 1200 ms), one silent frame.
    caller = quiet(200) + tone(100, 8000) + quiet(100)
    out = write_run(
        tmp_path,
        events=[agent_audio(0, 100), caller_audio(1200, 100)],
        agent=tone(100, 16000),
        caller=caller,
    )
    levels = build_levels(out, bins=20)
    assert [i for i, v in enumerate(levels.caller) if v > 0] == [12]
    # One scale for both lanes: the loudest bin of either is 1.
    assert levels.agent[0] == 1.0
    assert levels.caller[12] == pytest.approx(0.5)


def test_a_partial_last_speech_frame_keeps_later_frames_in_place(tmp_path):
    assert FRAME_BYTES == 100 * BYTES_PER_MS
    caller = tone(100, 8000) + tone(50, 8000) + quiet(100) + tone(100, 16000)
    out = write_run(
        tmp_path,
        events=[caller_audio(0, 100, 1), caller_audio(100, 50, 2), caller_audio(1500, 100, 3)],
        caller=caller,
    )
    levels = build_levels(out, bins=20)
    assert [i for i, v in enumerate(levels.caller) if v > 0] == [0, 1, 15]
    assert levels.caller[15] == 1.0
    # half of bin 1 is speech
    assert levels.caller[1] == pytest.approx(0.5 * math.sqrt(0.5), abs=1e-3)


def test_the_caller_cutting_the_agent_stops_its_playback(tmp_path):
    # 300 ms received at once; the caller cuts in at 150 ms: the rest never played.
    out = write_run(
        tmp_path,
        events=[
            agent_audio(0, 300),
            {"type": "caller_interrupted", "t_ms": 150, "agent_turn": 1, "audio_end_ms": 150},
            agent_audio(1000, 100, 2),
        ],
        agent=tone(300, 16000) + tone(100, 16000),
    )
    levels = build_levels(out, bins=20)
    assert [i for i, v in enumerate(levels.agent) if v > 0] == [0, 1, 10]
    assert levels.agent[1] == pytest.approx(math.sqrt(0.5), abs=1e-3)


def test_turns_come_from_the_transcript_with_their_refs(tmp_path):
    transcript = [
        {"role": "agent", "text": "Hi", "start_ms": 100.0, "end_ms": 300.0,
         "playback_end_ms": 900.0},
        {"role": "caller", "text": "Hello", "start_ms": 1000.0, "end_ms": 1400.0},
        {"role": "agent", "text": "Sure", "start_ms": 1600.0, "end_ms": 1900.0},
        {"role": "caller", "text": "never said", "start_ms": None, "end_ms": None},
    ]  # fmt: skip
    out = write_run(tmp_path, events=[], transcript=transcript)
    assert build_levels(out, bins=20).turns == [
        {"role": "agent", "startMs": 100, "endMs": 900, "ref": "A1"},
        {"role": "caller", "startMs": 1000, "endMs": 1400, "ref": "C1"},
        {"role": "agent", "startMs": 1600, "endMs": 1900, "ref": "A2"},
    ]


def test_missing_events_give_silent_lanes(tmp_path):
    out = write_run(tmp_path, events=None, agent=tone(100, 16000))
    levels = build_levels(out, bins=40)
    assert levels.agent == levels.caller == [0.0] * 40
    assert levels.duration_ms == 2000


def test_audio_past_the_summary_duration_extends_the_timeline(tmp_path):
    out = write_run(
        tmp_path, events=[agent_audio(1950, 100)], agent=tone(100, 16000), duration_ms=1000
    )
    levels = build_levels(out, bins=20)
    assert levels.duration_ms == 2050


# --- API ------------------------------------------------------------------------------------


async def test_levels_require_authentication(client):
    assert (await client.get(f"/api/runs/{uuid.uuid4()}/levels")).status_code == 401


async def test_levels_of_an_unknown_run_are_404(user_client):
    assert (await user_client.get(f"/api/runs/{uuid.uuid4()}/levels")).status_code == 404


async def test_levels_of_a_run_in_progress_are_409(app, user_client):
    run_id = await insert_run(app.state.sessionmaker, status="running")
    response = await user_client.get(f"/api/runs/{run_id}/levels")
    assert response.status_code == 409
    assert response.json()["detail"] == "Run still in progress"


@pytest.mark.parametrize("bins", [19, 401])
async def test_levels_bins_are_bounded(app, user_client, bins):
    run_id = await insert_run(app.state.sessionmaker)
    assert (await user_client.get(f"/api/runs/{run_id}/levels?bins={bins}")).status_code == 422


async def test_levels_of_a_finished_run(app, user_client):
    inserted = await insert_run(app.state.sessionmaker)
    write_run(
        app.state.runs.artifacts_dir(inserted),
        events=[agent_audio(0, 100)],
        agent=tone(100, 16000),
        transcript=[{"role": "agent", "text": "Hi", "start_ms": 0.0, "end_ms": 100.0}],
    )
    response = await user_client.get(f"/api/runs/{inserted}/levels")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"durationMs", "agent", "caller", "turns"}
    assert body["durationMs"] == 2000
    assert len(body["agent"]) == len(body["caller"]) == 140  # the default
    assert body["agent"][0] == 1.0
    assert body["turns"] == [{"role": "agent", "startMs": 0, "endMs": 100, "ref": "A1"}]
    fewer = await user_client.get(f"/api/runs/{inserted}/levels?bins=20")
    assert len(fewer.json()["agent"]) == 20


async def test_levels_of_a_run_without_artifacts_are_silent(app, user_client):
    run_id = await insert_run(app.state.sessionmaker, summary={"duration_ms": 5000})
    response = await user_client.get(f"/api/runs/{run_id}/levels?bins=20")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "durationMs": 5000,
        "agent": [0.0] * 20,
        "caller": [0.0] * 20,
        "turns": [],
    }
