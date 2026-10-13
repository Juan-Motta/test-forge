"""The conversation recording: both sides mixed in one mono WAV, on the run timeline.

Each side is placed like the levels place it (from `events.jsonl`), so pauses, overlaps and the
cut of an interrupted agent turn sound as they happened.
"""

import io
import struct
import uuid
import wave

from runs_support import agent_audio, caller_audio, insert_run, quiet, tone, write_run

from voice_eval.audio import SAMPLE_RATE
from voice_eval.modules.runs.conversation import build_conversation

SAMPLES_PER_MS = SAMPLE_RATE // 1000


def samples_of(wav: bytes) -> list[int]:
    with wave.open(io.BytesIO(wav), "rb") as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, SAMPLE_RATE)
        frames = w.readframes(w.getnframes())
    return list(struct.unpack(f"<{len(frames) // 2}h", frames))


def peak(samples: list[int], start_ms: float, end_ms: float) -> int:
    window = samples[round(start_ms * SAMPLES_PER_MS) : round(end_ms * SAMPLES_PER_MS)]
    return max((abs(s) for s in window), default=0)


def test_each_voice_starts_at_its_run_time_with_silence_between_turns(tmp_path):
    out = write_run(
        tmp_path,
        events=[agent_audio(500, 100), caller_audio(1200, 100)],
        agent=tone(100, 16000),
        caller=quiet(300) + tone(100, 8000),  # open-microphone silence before the speech
    )
    samples = samples_of(build_conversation(out))
    assert len(samples) == 2000 * SAMPLES_PER_MS  # the summary's duration
    assert peak(samples, 0, 500) == 0
    assert peak(samples, 500, 600) == 16000
    assert peak(samples, 600, 1200) == 0
    assert peak(samples, 1200, 1300) == 8000
    assert peak(samples, 1300, 2000) == 0


def test_an_interrupted_agent_turn_is_cut_where_the_caller_cut_in(tmp_path):
    out = write_run(
        tmp_path,
        events=[
            agent_audio(0, 300),
            {"type": "caller_interrupted", "t_ms": 150, "agent_turn": 1, "audio_end_ms": 150},
            agent_audio(1000, 100, 2),
        ],
        agent=tone(300, 16000) + tone(100, 4000),
    )
    samples = samples_of(build_conversation(out))
    assert peak(samples, 0, 150) == 16000
    assert peak(samples, 150, 1000) == 0
    assert peak(samples, 1000, 1100) == 4000


def test_overlapping_voices_are_summed_and_clipped(tmp_path):
    out = write_run(
        tmp_path,
        events=[agent_audio(0, 200), caller_audio(0, 100), caller_audio(100, 100, 2)],
        agent=tone(200, 30000),
        caller=tone(100, 30000) + tone(100, 1000),
    )
    samples = samples_of(build_conversation(out))
    overlap = samples[: 100 * SAMPLES_PER_MS]
    assert set(overlap) == {-32768, 32767}  # +/-60000 clipped to PCM16
    assert peak(samples, 100, 200) == 31000  # summed, under the limit


def test_audio_past_the_summary_duration_extends_the_recording(tmp_path):
    out = write_run(
        tmp_path, events=[agent_audio(950, 100)], agent=tone(100, 16000), duration_ms=1000
    )
    samples = samples_of(build_conversation(out))
    assert len(samples) == 1050 * SAMPLES_PER_MS
    assert peak(samples, 950, 1050) == 16000


def test_a_run_without_audio_files_has_no_recording(tmp_path):
    (tmp_path / "summary.json").write_text('{"duration_ms": 1000}')
    assert build_conversation(tmp_path) is None


def test_one_side_is_enough_for_a_recording(tmp_path):
    out = write_run(tmp_path, events=[agent_audio(0, 100)], agent=tone(100, 16000))
    (out / "caller.wav").unlink()
    samples = samples_of(build_conversation(out))
    assert peak(samples, 0, 100) == 16000


# --- API ------------------------------------------------------------------------------------


async def test_conversation_requires_authentication(client):
    response = await client.get(f"/api/runs/{uuid.uuid4()}/audio/conversation")
    assert response.status_code == 401


async def test_conversation_of_an_unknown_run_is_404(user_client):
    response = await user_client.get(f"/api/runs/{uuid.uuid4()}/audio/conversation")
    assert response.status_code == 404
    assert response.json()["detail"] == "Run not found"


async def test_conversation_without_audio_is_404(app, user_client):
    run_id = await insert_run(app.state.sessionmaker)
    response = await user_client.get(f"/api/runs/{run_id}/audio/conversation")
    assert response.status_code == 404
    assert response.json()["detail"] == "Audio not found"


async def test_conversation_is_a_wav_played_inline(app, user_client):
    run_id = await insert_run(app.state.sessionmaker)
    write_run(
        app.state.runs.artifacts_dir(run_id),
        events=[agent_audio(0, 100), caller_audio(500, 100)],
        agent=tone(100, 16000),
        caller=tone(100, 8000),
    )
    response = await user_client.get(f"/api/runs/{run_id}/audio/conversation")
    assert response.status_code == 200, response.text  # not a 422 for an unknown channel
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["content-disposition"].startswith("inline")
    samples = samples_of(response.content)
    assert peak(samples, 0, 100) == 16000
    assert peak(samples, 500, 600) == 8000


async def test_conversation_download_names_the_file(app, user_client):
    run_id = await insert_run(app.state.sessionmaker)
    write_run(
        app.state.runs.artifacts_dir(run_id), events=[agent_audio(0, 100)], agent=tone(100, 1)
    )
    response = await user_client.get(f"/api/runs/{run_id}/audio/conversation?download=1")
    assert response.status_code == 200, response.text
    name = f"run-{str(run_id)[:8]}-conversation.wav"
    assert response.headers["content-disposition"] == f'attachment; filename="{name}"'


async def test_the_side_tracks_are_still_served(app, user_client):
    run_id = await insert_run(app.state.sessionmaker)
    write_run(
        app.state.runs.artifacts_dir(run_id), events=[agent_audio(0, 100)], agent=tone(100, 1)
    )
    assert (await user_client.get(f"/api/runs/{run_id}/audio/agent")).status_code == 200
    assert (await user_client.get(f"/api/runs/{run_id}/audio/other")).status_code == 422


async def test_conversation_supports_byte_ranges_so_the_player_can_seek(app, user_client):
    run_id = await insert_run(app.state.sessionmaker)
    write_run(
        app.state.runs.artifacts_dir(run_id), events=[agent_audio(0, 100)], agent=tone(100, 1)
    )
    response = await user_client.get(
        f"/api/runs/{run_id}/audio/conversation", headers={"Range": "bytes=0-99"}
    )
    assert response.status_code == 206, response.text
    assert response.headers["accept-ranges"] == "bytes"
    assert len(response.content) == 100


async def test_conversation_is_mixed_once_and_kept_with_the_artifacts(app, user_client):
    run_id = await insert_run(app.state.sessionmaker)
    out = app.state.runs.artifacts_dir(run_id)
    write_run(out, events=[agent_audio(0, 100)], agent=tone(100, 1000))
    first = await user_client.get(f"/api/runs/{run_id}/audio/conversation")
    assert (out / "conversation.wav").read_bytes() == first.content
    (out / "agent.wav").unlink()  # a second request serves the kept mix
    second = await user_client.get(f"/api/runs/{run_id}/audio/conversation")
    assert second.status_code == 200
    assert second.content == first.content


async def test_conversation_of_a_run_in_progress_is_409(app, user_client):
    run_id = await insert_run(app.state.sessionmaker, status="running")
    response = await user_client.get(f"/api/runs/{run_id}/audio/conversation")
    assert response.status_code == 409
    assert response.json()["detail"] == "Run still in progress"
