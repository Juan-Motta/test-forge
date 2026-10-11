"""Runs use cases over the database: launch planning, batches, and the run state transitions."""

import uuid

import pytest
from runs_support import AZURE_TTS_ONLY

from voice_eval.modules.runs import service
from voice_eval.modules.runs.domain import (
    BatchStatus,
    RunStatus,
    ScenariosNotRunnable,
    brief_from_snapshot,
    sanitize_error,
)


async def make_batch(db, factory, *, names=("First", "Second"), repetitions=2):
    ids = [uuid.UUID((await factory.scenario(name))["id"]) for name in names]
    async with db() as session:
        plans = await service.plan_runs(session, ids)
        return await service.create_batch(
            session, plans, repetitions=repetitions, concurrency=1, label=None, created_by=None
        )


async def test_plan_runs_reports_every_refused_scenario(db, factory):
    good = await factory.scenario("Good")
    no_voice = await factory.scenario("No voice", ttsConnectionId=None)
    azure = (await factory.post("/api/connections", {"name": "Azure", **AZURE_TTS_ONLY}))["id"]
    no_chat = await factory.scenario("No chat", ttsConnectionId=azure)
    ids = [uuid.UUID(s["id"]) for s in (good, no_voice, no_chat)] + [uuid.uuid4()]

    async with db() as session:
        with pytest.raises(ScenariosNotRunnable) as caught:
            await service.plan_runs(session, ids)

    errors = caught.value.errors
    assert [error["index"] for error in errors] == [1, 2, 3]
    assert "voice" in errors[0]["msg"]
    assert "chat deployment" in errors[1]["msg"]
    assert errors[2]["msg"] == "scenario not found"


async def test_create_batch_interleaves_runs_with_their_snapshot(db, factory):
    batch = await make_batch(db, factory)

    assert (batch.status, batch.total, batch.counts) == (BatchStatus.QUEUED, 4, {"queued": 4})
    assert [run.scenario_name for run in batch.runs] == ["First", "Second", "First", "Second"]
    assert [run.position for run in batch.runs] == [0, 1, 2, 3]
    brief = brief_from_snapshot(batch.runs[0].snapshot)
    assert brief.goal == "Learn the current account balance."
    assert brief.facts == (("account_number", "123-456"),)
    assert brief.agent_context == "Answers balance questions for retail customers."
    assert batch.runs[0].snapshot["connections"]["evaluator"]["chat_model"] == "gpt-4.1-mini"
    assert "secrets" not in str(batch.runs[0].snapshot)


async def test_the_batch_completes_when_its_last_run_ends(db, factory):
    batch = await make_batch(db, factory, names=("Only",), repetitions=2)
    first, second = batch.runs
    async with db() as session:
        await service.mark_started(session, first.id, batch.id)
        await service.mark_running(session, first.id)
        assert (await service.get_batch(session, batch.id)).status is BatchStatus.RUNNING
        await service.mark_finished(
            session,
            first.id,
            batch.id,
            status=RunStatus.COMPLETED,
            reason="caller_hung_up",
            summary={"status": "completed"},
            artifacts_dir="/data/runs/x",
            error=None,
        )
        assert (await service.get_batch(session, batch.id)).status is BatchStatus.RUNNING
        await service.mark_finished(
            session,
            second.id,
            batch.id,
            status=RunStatus.CANCELLED,
            reason="cancelled",
            summary=None,
            artifacts_dir=None,
            error=None,
        )
        done = await service.get_batch(session, batch.id)
        ended = await service.get_run(session, first.id)

    assert done.status is BatchStatus.COMPLETED
    assert done.counts == {"completed": 1, "cancelled": 1}
    assert (ended.status, ended.end_reason) == (RunStatus.COMPLETED, "caller_hung_up")
    assert ended.started_at is not None and ended.ended_at is not None


async def test_a_terminal_run_is_never_rewritten(db, factory):
    batch = await make_batch(db, factory, names=("Only",), repetitions=1)
    (run,) = batch.runs
    async with db() as session:
        for status in (RunStatus.CANCELLED, RunStatus.COMPLETED):
            await service.mark_finished(
                session,
                run.id,
                batch.id,
                status=status,
                reason=status.value,
                summary=None,
                artifacts_dir=None,
                error=None,
            )
        assert (await service.get_run(session, run.id)).status is RunStatus.CANCELLED


async def test_mark_interrupted_ends_every_unfinished_run(db, factory):
    batch = await make_batch(db, factory)
    async with db() as session:
        await service.mark_started(session, batch.runs[0].id, batch.id)
        assert await service.mark_interrupted(session) == 4
        runs, total = await service.list_runs(session, batch_id=batch.id)
        settled = await service.get_batch(session, batch.id)

    assert total == 4
    assert {(run.status, run.end_reason) for run in runs} == {
        (RunStatus.INTERRUPTED, "server_restarted")
    }
    assert settled.status is BatchStatus.COMPLETED


def test_sanitize_error_keeps_one_short_printable_line():
    assert sanitize_error(None) is None
    assert sanitize_error("a\nb\x1b[0m\tc") == "a b [0m c"
    long = sanitize_error("x" * 600)
    assert len(long) == 500 and long.endswith("…")
