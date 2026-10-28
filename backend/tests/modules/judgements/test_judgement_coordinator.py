"""The judgement coordinator over a real database, with a fake clock, Langfuse reader and judge.

Runs are written straight to the database; `harness` (see conftest) installs the fakes on
`app.state.judgements`, so nothing waits for real and no provider is contacted.
"""

import asyncio
import json
import uuid
from datetime import timedelta

from judgements_support import (
    ENDED,
    EVALUATOR_ID,
    LANGFUSE_ID,
    MALFORMED,
    STARTED,
    FakeJudgeModel,
    ScriptedReader,
    insert_run,
    judgement_row,
    observation,
    settled,
    snapshot,
    write_artifacts,
)
from sqlalchemy import update

from voice_eval.modules.agents.models import AgentRecord
from voice_eval.modules.judgements import service
from voice_eval.modules.judgements.coordinator import POLL_INTERVAL_S, RECONCILE_WINDOW
from voice_eval.modules.judgements.models import RunJudgementRecord
from voice_eval.modules.runs.models import RunRecord
from voice_eval.ports.usage import UsageMeter
from voice_eval.providers.langfuse_traces import TraceFetchError


async def judge(app, run_id: uuid.UUID) -> RunJudgementRecord:
    coordinator = app.state.judgements
    await coordinator.schedule(run_id)
    await settled(coordinator, run_id)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert row is not None
    return row


async def test_traces_are_polled_until_stable_then_judged(app, harness, tmp_path):
    out = tmp_path / "run"
    write_artifacts(out)
    run_id = await insert_run(app.state.sessionmaker, artifacts_dir=out)
    two = [observation(0), observation(1)]
    harness.reader = ScriptedReader([], [observation(0)], two, two)

    row = await judge(app, run_id)

    assert (row.status, row.error, row.attempt) == ("completed", None, 1)
    assert len(harness.reader.calls) == 4  # empty, 1, 2, 2 again -> stable
    assert harness.clock.sleeps == [POLL_INTERVAL_S] * 3
    call = harness.reader.calls[0]
    assert call["session_id"] == f"thread-{str(run_id)[:8]}"
    assert call["start"] == STARTED - timedelta(minutes=5)
    assert call["end"] == ENDED + timedelta(minutes=30)
    # the second judge model is the translation's, built fresh like the judge's
    assert harness.built == [
        ("traces", LANGFUSE_ID),
        ("judge", EVALUATOR_ID),
        ("judge", EVALUATOR_ID),
    ]

    assert row.trace_note is None
    assert row.trace_stats["observationCount"] == 2
    assert row.model == "gpt-6-luna"
    result = row.result
    assert result["version"] == 2
    assert result["overallScore"] == 62  # (60 x 70 + 40 x 50) / 100: bands 3 and 2
    assert [c["verdict"] for c in result["criteria"]] == ["partial", "fail"]
    assert [c["band"] for c in result["criteria"]] == [3, 2]
    assert result["failureTags"] == {"tool_or_trace_error": 1}
    assert result["traceStats"]["observationCount"] == 2
    assert result["brief"].startswith("#")
    assert json.loads((out / "langfuse.json").read_text()) == two

    prompt = json.dumps(harness.model.messages[0])
    assert "It is 120 dollars." in prompt and "llm-1" in prompt


async def test_a_relay_run_reads_the_traces_of_the_agent_s_own_session(app, harness, tmp_path):
    # A relay agent's session is the one its session URL answered, not the run's thread id.
    out = tmp_path / "run"
    write_artifacts(out)
    summary = {"protocol": "relay", "session_id": "agent-session-1"}
    run_id = await insert_run(app.state.sessionmaker, artifacts_dir=out, summary=summary)
    harness.reader = ScriptedReader([observation(0)], [observation(0)])

    row = await judge(app, run_id)

    assert row.status == "completed"
    assert {call["session_id"] for call in harness.reader.calls} == {"agent-session-1"}


async def test_an_agent_without_langfuse_is_judged_without_traces(app, harness, tmp_path):
    out = tmp_path / "run"
    write_artifacts(out)
    run_id = await insert_run(
        app.state.sessionmaker, data=snapshot(langfuse=None), artifacts_dir=out
    )

    row = await judge(app, run_id)

    assert row.status == "completed"
    assert row.trace_note == "This agent has no Langfuse connection."
    assert row.trace_stats is None
    assert row.result["traceNote"] == row.trace_note
    criteria = row.result["criteria"]
    assert [c["unobservableReason"] for c in criteria] == [None, "traces_unavailable"]
    assert row.result["overallScore"] == 70  # only the transcript criterion (band 3) counts
    prompt = harness.model.messages[0][1]["content"]
    assert "<not_judged>" in prompt and "traces_unavailable" in prompt
    assert harness.reader.calls == [] and harness.clock.sleeps == []
    assert not (out / "langfuse.json").exists()


async def test_older_runs_fall_back_to_the_agent_langfuse_connection(
    app, harness, user_client, tmp_path
):
    created = await user_client.post(
        "/api/connections",
        json={
            "name": "lf",
            "kind": "langfuse",
            "config": {"host": "https://cloud.langfuse.com", "publicKey": "pk-lf-1"},
            "secrets": {"secretKey": "sk-lf-abcdefghijkl"},
        },
    )
    assert created.status_code == 201, created.text
    langfuse_id = created.json()["id"]
    agent = await user_client.post(
        "/api/agents",
        json={
            "name": "Vivi",
            "context": "Balance questions.",
            "baseUrl": "wss://agents.example.com",
            "channelId": "c",
            "userId": "u",
            "langfuseConnectionId": langfuse_id,
        },
    )
    assert agent.status_code == 201, agent.text
    agent_id = uuid.UUID(agent.json()["id"])
    sessionmaker = app.state.sessionmaker
    legacy = await insert_run(sessionmaker, data=snapshot(legacy=True), agent_id=agent_id)
    orphan = await insert_run(sessionmaker, data=snapshot(legacy=True))
    harness.reader = ScriptedReader([observation(0)])

    assert (await judge(app, legacy)).trace_note is None
    assert harness.built[0] == ("traces", langfuse_id)
    assert (await judge(app, orphan)).trace_note == "This agent has no Langfuse connection."

    async with sessionmaker() as db:  # the agent row is unlinked: no traces either
        await db.execute(update(AgentRecord).values(langfuse_connection_id=None))
        await db.commit()
    await app.state.judgements.rejudge(legacy)
    await settled(app.state.judgements, legacy)
    row = await judgement_row(sessionmaker, legacy)
    assert row.trace_note == "This agent has no Langfuse connection."


async def test_no_traces_within_the_wait_budget(app, harness, tmp_path):
    run_id = await insert_run(app.state.sessionmaker, summary={"status": "completed"})

    row = await judge(app, run_id)

    assert row.status == "completed"
    assert sum(harness.clock.sleeps) <= 20 * 60
    assert harness.clock.moment <= ENDED + timedelta(minutes=20)
    assert len(harness.reader.calls) == len(harness.clock.sleeps) + 1 > 30
    assert row.trace_note == (
        f"No Langfuse traces found for session thread-{str(run_id)[:8]} within 20 min."
    )
    assert row.trace_stats is None


async def test_a_late_rejudge_fetches_once(app, harness):
    run_id = await insert_run(app.state.sessionmaker)
    harness.clock.moment = ENDED + timedelta(hours=3)
    harness.reader = ScriptedReader([observation(0)])

    row = await judge(app, run_id)

    assert (len(harness.reader.calls), harness.clock.sleeps) == (1, [])
    assert row.trace_note is None and row.trace_stats["observationCount"] == 1


async def test_fetch_errors_are_retried_then_reported(app, harness):
    sessionmaker = app.state.sessionmaker
    transient = await insert_run(sessionmaker)
    one = [observation(0)]
    harness.reader = ScriptedReader(TraceFetchError("Langfuse is unavailable (HTTP 503)"), one)

    row = await judge(app, transient)
    assert (row.status, row.trace_note) == ("completed", None)
    assert len(harness.reader.calls) == 3

    persistent = await insert_run(sessionmaker)
    harness.clock.moment = ENDED + timedelta(minutes=19)
    harness.reader = ScriptedReader(TraceFetchError("Langfuse rejected the credentials"))
    row = await judge(app, persistent)
    assert row.status == "completed"
    assert row.trace_note == "Langfuse traces could not be read: Langfuse rejected the credentials"


async def test_an_unusable_langfuse_connection_is_a_note_not_a_failure(app, harness):
    async def broken(db, connection_id):
        raise RuntimeError("secret sk-lf-abcdefghijkl leaked?")

    app.state.judgements.build_trace_reader = broken
    row = await judge(app, await insert_run(app.state.sessionmaker))

    assert row.status == "completed"
    assert "RuntimeError" in row.trace_note and "sk-lf" not in row.trace_note


async def test_judge_failures_fail_the_judgement_safely(app, harness):
    sessionmaker = app.state.sessionmaker
    harness.model.error = MALFORMED
    row = await judge(app, await insert_run(sessionmaker, data=snapshot(langfuse=None)))
    assert row.status == "failed"
    assert row.error == "malformed judge answer (does not match the judgement schema)"
    assert row.result is None and row.completed_at is not None
    assert row.trace_note == "This agent has no Langfuse connection."

    async def broken(db, connection_id):
        raise RuntimeError("secret sk-proj-abcdefghijklmnop leaked?")

    app.state.judgements.build_judge = broken
    row = await judge(app, await insert_run(sessionmaker, data=snapshot(langfuse=None)))
    assert row.status == "failed"
    assert row.error == "the evaluator connection could not be used (RuntimeError)"


async def test_a_scenario_without_criteria_fails(app, harness):
    data = snapshot(langfuse=None)
    data["scenario"]["criteria"] = []
    row = await judge(app, await insert_run(app.state.sessionmaker, data=data))
    assert (row.status, row.error) == ("failed", "the run's scenario has no criteria to judge")


async def test_rejudge_replaces_the_result_and_refuses_while_active(app, harness):
    from voice_eval.modules.judgements.domain import JudgementInProgress

    coordinator = app.state.judgements
    run_id = await insert_run(app.state.sessionmaker, data=snapshot(langfuse=None))
    harness.model.error = MALFORMED
    assert (await judge(app, run_id)).status == "failed"

    harness.model.error = None
    harness.model.gate = asyncio.Event()
    again = await coordinator.rejudge(run_id)
    assert (again.status.value, again.attempt) == ("pending", 2)
    try:
        await coordinator.rejudge(run_id)
    except JudgementInProgress:
        pass
    else:
        raise AssertionError("a second re-judge must be refused while one is active")
    await coordinator.schedule(run_id)  # the manager's call is a no-op meanwhile

    harness.model.gate.set()
    await settled(coordinator, run_id)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert (row.status, row.attempt, row.error) == ("completed", 2, None)
    assert row.result["overallScore"] == 70


async def test_a_superseded_attempt_never_overwrites_the_new_one(app, harness):
    sessionmaker = app.state.sessionmaker
    run_id = await insert_run(sessionmaker, data=snapshot(langfuse=None))
    async with sessionmaker() as db:
        first = await service.start(db, run_id)
        assert await service.mark_failed(db, run_id, first.attempt, "boom")
        second = await service.start(db, run_id)
        assert second.attempt == 2
        assert not await service.mark_completed(
            db, run_id, first.attempt, result={"overallScore": 1}, model="m"
        )
        assert (await service.get_judgement(db, run_id)).status.value == "pending"


async def test_recover_resumes_unfinished_judgements(app, harness):
    sessionmaker = app.state.sessionmaker
    stuck = await insert_run(sessionmaker, data=snapshot(langfuse=None))
    done = await insert_run(sessionmaker, data=snapshot(langfuse=None))
    async with sessionmaker() as db:
        db.add(RunJudgementRecord(run_id=stuck, status="judging", attempt=3))
        db.add(RunJudgementRecord(run_id=done, status="failed", attempt=1, error="old"))
        await db.commit()

    await app.state.judgements.recover()
    assert not app.state.judgements.is_active(done)
    await settled(app.state.judgements, stuck)

    row = await judgement_row(sessionmaker, stuck)
    assert (row.status, row.attempt) == ("completed", 3)
    assert (await judgement_row(sessionmaker, done)).status == "failed"


async def test_shutdown_leaves_the_judgement_unfinished(app, harness):
    run_id = await insert_run(app.state.sessionmaker)
    harness.reader.gate = asyncio.Event()  # never released
    await app.state.judgements.schedule(run_id)
    while not harness.reader.calls:  # noqa: ASYNC110 - waiting for the task to reach Langfuse
        await asyncio.sleep(0.01)

    await app.state.judgements.shutdown()

    row = await judgement_row(app.state.sessionmaker, run_id)
    assert row.status == "collecting_traces"
    later = await insert_run(app.state.sessionmaker)
    await app.state.judgements.schedule(later)
    assert not app.state.judgements.is_active(later)  # stopping: left pending for the next start
    assert (await judgement_row(app.state.sessionmaker, later)).status == "pending"


async def test_recover_judges_recent_judgeable_runs_left_without_a_judgement(app, harness):
    sessionmaker = app.state.sessionmaker
    no_traces = snapshot(langfuse=None)
    completed = await insert_run(sessionmaker, data=no_traces)
    spoke = await insert_run(
        sessionmaker, data=no_traces, status="failed", summary={"agent_turns": 2}
    )
    silent = await insert_run(
        sessionmaker, data=no_traces, status="failed", summary={"agent_turns": 0}
    )
    cancelled = await insert_run(sessionmaker, data=no_traces, status="cancelled")
    old = await insert_run(sessionmaker, data=no_traces)
    judged = await insert_run(sessionmaker, data=no_traces)
    async with sessionmaker() as db:
        await db.execute(
            update(RunRecord)
            .where(RunRecord.id == old)
            .values(ended_at=harness.clock.now() - RECONCILE_WINDOW - timedelta(minutes=1))
        )
        db.add(RunJudgementRecord(run_id=judged, status="completed", attempt=2))
        await db.commit()

    await app.state.judgements.recover()
    for run_id in (completed, spoke):
        await settled(app.state.judgements, run_id)
        row = await judgement_row(sessionmaker, run_id)
        assert (row.status, row.attempt) == ("completed", 1)
    for run_id in (silent, cancelled, old):
        assert await judgement_row(sessionmaker, run_id) is None
    assert (await judgement_row(sessionmaker, judged)).attempt == 2  # untouched


async def test_any_reader_error_is_retried_then_a_note_never_a_failure(app, harness):
    sessionmaker = app.state.sessionmaker
    harness.reader = ScriptedReader(RuntimeError("boom sk-lf-abcdefghijkl"), [observation(0)])
    row = await judge(app, await insert_run(sessionmaker))
    assert (row.status, row.trace_note) == ("completed", None)

    harness.clock.moment = ENDED + timedelta(minutes=19)
    harness.reader = ScriptedReader(RuntimeError("boom sk-lf-abcdefghijkl"))
    row = await judge(app, await insert_run(sessionmaker))
    assert row.status == "completed"
    assert "RuntimeError" in row.trace_note and "sk-lf" not in row.trace_note


async def test_a_reconcile_error_on_one_run_still_judges_the_others(app, harness, monkeypatch):
    sessionmaker = app.state.sessionmaker
    no_traces = snapshot(langfuse=None)
    first = await insert_run(sessionmaker, data=no_traces)
    broken = await insert_run(sessionmaker, data=no_traces)
    last = await insert_run(sessionmaker, data=no_traces)
    real_start_missing = service.start_missing

    async def start_missing(db, run_id):
        if run_id == broken:
            raise RuntimeError("database hiccup")
        return await real_start_missing(db, run_id)

    monkeypatch.setattr(service, "start_missing", start_missing)

    await app.state.judgements.recover()

    for run_id in (first, last):
        await settled(app.state.judgements, run_id)
        row = await judgement_row(sessionmaker, run_id)
        assert (row.status, row.attempt) == ("completed", 1)
    assert await judgement_row(sessionmaker, broken) is None  # the next start retries it


async def test_a_text_run_is_judged_as_a_chat_correlated_by_its_thread(app, harness, tmp_path):
    out = tmp_path / "run"
    out.mkdir()
    transcript = [
        {"role": "caller", "text": "My balance, please.", "start_ms": 0.0, "end_ms": 0.0},
        {"role": "agent", "text": "It is 120 dollars.", "start_ms": 700.0, "end_ms": 900.0,
         "latency_ms": 700.0, "first_text_ms": 700, "tools": ["get_balance"]},
    ]  # fmt: skip
    summary = {
        "kind": "text", "status": "completed", "reason": "caller_hung_up", "text_mode": "stream",
        "duration_ms": 1000.0, "caller_turns": 1, "agent_turns": 1, "latencies_ms": [700.0],
        "turns": [{"index": 1, "kind": "reply", "request_ms": 0.0, "first_text_ms": 700.0,
                   "end_ms": 900.0, "latency_ms": 700.0, "tools": ["get_balance"]}],
        "interruptions": [], "warnings": [],
    }  # fmt: skip
    (out / "transcript.json").write_text(json.dumps(transcript))
    (out / "summary.json").write_text(json.dumps(summary))
    data = snapshot()
    data["agent"] |= {"kind": "text", "protocol": "http_chat", "text_mode": "stream"}
    data["connections"]["tts"] = None
    run_id = await insert_run(app.state.sessionmaker, data=data, artifacts_dir=out)
    two = [observation(0), observation(1)]
    harness.reader = ScriptedReader(two, two)

    row = await judge(app, run_id)

    assert row.status == "completed"
    assert harness.reader.calls[0]["session_id"] == f"thread-{str(run_id)[:8]}"
    system, user = harness.model.messages[0]
    assert "text chat agents" in system["content"]
    assert "USER: My balance, please." in user["content"]
    assert "(tools used: get_balance)" in user["content"]
    assert row.result["brief"].startswith("# Text agent review: Vivi / Balance\n")


class MeteredJudgeModel(FakeJudgeModel):
    """Each call (failed ones too) uses 100 input and 10 output tokens of gpt-6-luna."""

    def __init__(self) -> None:
        super().__init__()
        self.usage = UsageMeter()

    async def judge(self, messages):
        self.usage.add("gpt-6-luna", text_in=100, text_out=10)
        return await super().judge(messages)


async def test_judge_usage_is_kept_per_result_and_summed_over_every_attempt(app, harness):
    coordinator = app.state.judgements
    run_id = await insert_run(app.state.sessionmaker, data=snapshot(langfuse=None))
    harness.model = MeteredJudgeModel()
    harness.model.error = MALFORMED
    row = await judge(app, run_id)
    assert row.status == "failed"
    # every sample was asked (and billed) before the judgement failed
    assert row.usage == {"by_model": {"gpt-6-luna": {"text_in": 300, "text_out": 30}}}

    harness.model = MeteredJudgeModel()  # a new judge model per judgement, as built for real
    await coordinator.rejudge(run_id)
    await settled(coordinator, run_id)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert row.status == "completed"
    assert row.result["usage"] == {"by_model": {"gpt-6-luna": {"text_in": 300, "text_out": 30}}}
    assert row.usage == {"by_model": {"gpt-6-luna": {"text_in": 600, "text_out": 60}}}


async def test_a_judge_model_without_a_meter_records_no_usage(app, harness):
    row = await judge(app, await insert_run(app.state.sessionmaker, data=snapshot(langfuse=None)))
    assert row.status == "completed"
    assert row.usage is None
    assert row.result["usage"] is None
