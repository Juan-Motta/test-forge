"""`voice-eval judge-stability`: judges a stored run N times on the same evidence, offline.

The CLI builds its own coordinator; `cli.build_coordinator` is wrapped so the coordinator gets
a fake Langfuse reader and a fake judge model. Nothing contacts a provider and nothing is stored.
"""

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import create_async_engine

from voice_eval import cli
from voice_eval.modules.judgements.models import RunJudgementRecord
from voice_eval.modules.runs.models import RunBatchRecord, RunRecord

MUST_ID = "11111111-1111-4111-8111-111111111111"
TRACE_ID = "22222222-2222-4222-8222-222222222222"
EVALUATOR_ID = "33333333-3333-4333-8333-333333333333"
LANGFUSE_ID = "44444444-4444-4444-8444-444444444444"
STARTED = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)
CRITERIA = [
    {"id": MUST_ID, "text": "States the balance", "kind": "must", "source": "transcript",
     "weight": 60},
    {"id": TRACE_ID, "text": "Calls the balance tool once", "kind": "should", "source": "trace",
     "weight": 40},
]  # fmt: skip
SNAPSHOT = {
    "scenario": {"id": str(uuid.uuid4()), "name": "Balance", "goal": "Learn the balance.",
                 "criteria": CRITERIA},
    "agent": {"id": str(uuid.uuid4()), "name": "Vivi", "protocol": "vivi_live",
              "langfuse_connection_id": LANGFUSE_ID},
    "connections": {"evaluator": {"id": EVALUATOR_ID, "name": "OpenAI",
                                  "chat_model": "gpt-6-luna"}},
}  # fmt: skip
TRANSCRIPT = [
    {"role": "agent", "text": "Hello, how can I help?", "start_ms": 0.0, "end_ms": 900.0},
    {"role": "caller", "text": "My balance, please.", "start_ms": 1500.0, "end_ms": 2500.0},
    {"role": "agent", "text": "It is 120 dollars.", "start_ms": 3400.0, "end_ms": 5000.0,
     "latency_ms": 900.0},
]  # fmt: skip
SUMMARY = {"status": "completed", "reason": "caller_hung_up", "duration_ms": 6000.0,
           "caller_turns": 1, "agent_turns": 2, "latencies_ms": [900.0], "turns": [],
           "warnings": []}  # fmt: skip
OBSERVATION = {
    "id": "obs-0",
    "traceId": "trace-1",
    "type": "GENERATION",
    "name": "llm-0",
    "startTime": (STARTED + timedelta(seconds=10)).isoformat(),
    "endTime": (STARTED + timedelta(seconds=11)).isoformat(),
    "providedModelName": "gpt-x",
}


class CountingReader:
    def __init__(self) -> None:
        self.calls = 0

    async def fetch_session(self, session_id: str, *, start: datetime, end: datetime) -> list:
        self.calls += 1
        return [OBSERVATION]


class BandsModel:
    """Answers with the next (must band, trace band) pair on each call."""

    def __init__(self, *bands: tuple[int, int]) -> None:
        self.bands = list(bands)
        self.messages: list[list[dict[str, Any]]] = []

    async def judge(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        must, trace = self.bands[len(self.messages) % len(self.bands)]
        self.messages.append(messages)
        return {
            "summary": "The agent stated the balance.",
            "criteria": [_verdict(MUST_ID, must), _verdict(TRACE_ID, trace)],
            "suggestions": [],
            "strengths": [],
        }


def _verdict(criterion_id: str, band: int) -> dict[str, Any]:
    return {
        "criterionId": criterion_id,
        "evidence": [{"source": "transcript", "ref": "A2", "quote": "It is 120 dollars."}],
        "reasoning": "reasoning",
        "observable": True,
        "band": band,
        "failureTags": [],
    }


class Fakes:
    def __init__(self) -> None:
        self.reader = CountingReader()
        self.model = BandsModel((4, 2), (4, 4), (3, 2))
        self.built: list[str] = []


@pytest.fixture
def fakes(app, settings, monkeypatch) -> Fakes:
    """CLI pointed at the test database (emptied by `app`), with fake providers."""
    installed = Fakes()
    real = cli.build_coordinator

    def build(settings_, sessionmaker):
        coordinator = real(settings_, sessionmaker)

        async def build_judge(db, connection_id):
            installed.built.append(f"judge:{connection_id}")
            return installed.model

        async def build_trace_reader(db, connection_id):
            installed.built.append(f"traces:{connection_id}")
            return installed.reader

        coordinator.build_judge = build_judge
        coordinator.build_trace_reader = build_trace_reader
        return coordinator

    monkeypatch.setattr(cli, "load_settings", lambda: settings)
    monkeypatch.setattr(cli, "build_coordinator", build)
    return installed


async def _insert_run(url: str, run_id: uuid.UUID, out: Path | None, status: str) -> None:
    engine = create_async_engine(url)
    try:
        async with engine.begin() as conn:
            batch_id = uuid.uuid4()
            await conn.execute(
                RunBatchRecord.__table__.insert().values(
                    id=batch_id, concurrency=1, status="completed", total_runs=1
                )
            )
            await conn.execute(
                RunRecord.__table__.insert().values(
                    id=run_id,
                    batch_id=batch_id,
                    position=0,
                    thread_id=f"thread-{str(run_id)[:8]}",
                    status=status,
                    snapshot=SNAPSHOT,
                    summary=SUMMARY,
                    artifacts_dir=str(out) if out else None,
                    started_at=STARTED,
                    ended_at=None if status == "running" else STARTED + timedelta(minutes=2),
                )
            )
    finally:
        await engine.dispose()


async def _judgement_rows(url: str) -> int:
    engine = create_async_engine(url)
    try:
        async with engine.connect() as conn:
            return (await conn.execute(select(func.count()).select_from(RunJudgementRecord))).one()[
                0
            ]
    finally:
        await engine.dispose()


def insert_run(settings, tmp_path, *, run_id: str | None = None, status="completed") -> str:
    identifier = uuid.UUID(run_id) if run_id else uuid.uuid4()
    out = tmp_path / str(identifier)
    out.mkdir(parents=True)
    (out / "transcript.json").write_text(json.dumps(TRANSCRIPT))
    (out / "summary.json").write_text(json.dumps(SUMMARY))
    asyncio.run(_insert_run(settings.database_url, identifier, out, status))
    return str(identifier)


def run_cli(argv: list[str]) -> int:
    with pytest.raises(SystemExit) as exit_info:
        cli.main(argv)
    return exit_info.value.code


def test_judges_the_run_n_times_on_one_trace_fetch_and_stores_nothing(
    fakes, settings, tmp_path, capsys
):
    run_id = insert_run(settings, tmp_path)

    assert run_cli(["judge-stability", run_id[:8]]) == 0

    out, err = capsys.readouterr()
    assert "3 model calls" in err
    assert fakes.reader.calls == 1
    assert len(fakes.model.messages) == 3
    assert fakes.model.messages[0] == fakes.model.messages[2]  # the same evidence every time
    assert fakes.built == [f"traces:{LANGFUSE_ID}", f"judge:{EVALUATOR_ID}"]
    assert "States the balance" in out and "4 4 3" in out
    assert "Calls the balance tool once" in out and "2 4 2" in out
    assert "criteria with band spread >= 2: 1 of 2" in out
    assert asyncio.run(_judgement_rows(settings.database_url)) == 0
    assert not (tmp_path / run_id / "langfuse.json").exists()


def test_json_output_and_times(fakes, settings, tmp_path, capsys):
    run_id = insert_run(settings, tmp_path)

    assert run_cli(["judge-stability", run_id, "--times", "2", "--json"]) == 0

    out, err = capsys.readouterr()
    assert "2 model calls" in err
    report = json.loads(out)
    assert report["runId"] == run_id
    assert report["samples"] == 2
    assert report["overall"]["scores"] == [74, 90]  # (60 x 90 + 40 x 50) / 100, then all 90
    assert [c["bands"] for c in report["criteria"]] == [[4, 4], [2, 4]]
    assert len(fakes.model.messages) == 2


@pytest.mark.parametrize("times", ["1", "11", "x"])
def test_times_must_be_between_2_and_10(times, capsys):
    assert run_cli(["judge-stability", "abcd1234", "--times", times]) == 2
    assert "--times" in capsys.readouterr().err


def test_unknown_run(fakes, capsys):
    assert run_cli(["judge-stability", "abcdef12"]) == cli.EXIT_INVALID_INPUT
    assert "no run matches 'abcdef12'" in capsys.readouterr().err
    assert fakes.model.messages == []


def test_malformed_reference(fakes, capsys):
    assert run_cli(["judge-stability", "ab"]) == cli.EXIT_INVALID_INPUT
    assert "run id or a prefix" in capsys.readouterr().err
    assert run_cli(["judge-stability", "zz%zzzzz"]) == cli.EXIT_INVALID_INPUT


def test_ambiguous_prefix(fakes, settings, tmp_path, capsys):
    insert_run(settings, tmp_path, run_id="abcd0000-0000-4000-8000-000000000001")
    insert_run(settings, tmp_path, run_id="abcd0000-0000-4000-8000-000000000002")

    assert run_cli(["judge-stability", "ABCD0000"]) == cli.EXIT_INVALID_INPUT

    assert "more than one run" in capsys.readouterr().err
    assert fakes.model.messages == []
    assert run_cli(["judge-stability", "abcd0000-0000-4000-8000-000000000002"]) == 0


def test_unfinished_run(fakes, settings, tmp_path, capsys):
    run_id = insert_run(settings, tmp_path, status="running")

    assert run_cli(["judge-stability", run_id]) == cli.EXIT_INVALID_INPUT

    assert "has not finished" in capsys.readouterr().err
    assert fakes.reader.calls == 0 and fakes.model.messages == []


def test_unjudgeable_run(fakes, settings, tmp_path, capsys):
    run_id = insert_run(settings, tmp_path, status="cancelled")

    assert run_cli(["judge-stability", run_id]) == cli.EXIT_INVALID_INPUT

    assert "cannot be judged" in capsys.readouterr().err
