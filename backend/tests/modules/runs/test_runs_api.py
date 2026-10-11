"""Runs API: launch validation, batches and snapshots, concurrency, cancel, list, audio, recovery.

Every run is driven by a fake (`BlockingDrive`): no agent or provider is ever contacted.
"""

import asyncio
import uuid

import pytest
from runs_support import AZURE_TTS_ONLY, wait_for
from sqlalchemy import select, update

from voice_eval.modules.runs.models import RunBatchRecord, RunRecord

TERMINAL = {"completed", "failed", "cancelled", "interrupted"}


async def launch(client, scenario_ids, **body):
    return await client.post("/api/runs", json={"scenarioIds": scenario_ids, **body})


async def run_status(client, run_id: str) -> str:
    response = await client.get(f"/api/runs/{run_id}")
    assert response.status_code == 200, response.text
    return response.json()["status"]


def all_in(client, run_ids, statuses):
    async def check() -> bool:
        return all([await run_status(client, run_id) in statuses for run_id in run_ids])

    return check


async def test_requires_authentication(client):
    some = uuid.uuid4()
    assert (await client.get("/api/runs")).status_code == 401
    assert (await launch(client, [str(some)])).status_code == 401
    assert (await client.get(f"/api/runs/{some}")).status_code == 401
    assert (await client.post(f"/api/runs/{some}/cancel")).status_code == 401
    assert (await client.get(f"/api/runs/{some}/audio/agent")).status_code == 401
    assert (await client.get("/api/runs/batches")).status_code == 401
    assert (await client.post(f"/api/runs/batches/{some}/cancel")).status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        {"scenarioIds": []},
        {"scenarioIds": [str(uuid.uuid4()) for _ in range(21)]},
        {"scenarioIds": [str(uuid.uuid4())], "repetitions": 0},
        {"scenarioIds": [str(uuid.uuid4())], "repetitions": 11},
        {"scenarioIds": [str(uuid.uuid4())], "concurrency": 0},
        {"scenarioIds": [str(uuid.uuid4())], "concurrency": 11},
        {"scenarioIds": [str(uuid.uuid4())], "label": "x" * 121},
        {"scenarioIds": [str(uuid.uuid4())], "unknown": 1},
    ],
)
async def test_launch_shape_validation(user_client, body):
    response = await user_client.post("/api/runs", json=body)
    assert response.status_code == 422


async def test_unrunnable_scenarios_are_listed_with_reasons(user_client, factory, drive):
    good = await factory.scenario("Good")
    no_voice = await factory.scenario("No voice", ttsConnectionId=None)
    azure = (await factory.post("/api/connections", {"name": "Azure", **AZURE_TTS_ONLY}))["id"]
    no_chat = await factory.scenario("No chat", ttsConnectionId=azure)
    missing = str(uuid.uuid4())

    response = await launch(user_client, [good["id"], no_voice["id"], no_chat["id"], missing])

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    by_id = {item["scenarioId"]: item for item in detail}
    assert set(by_id) == {no_voice["id"], no_chat["id"], missing}
    assert by_id[no_voice["id"]]["loc"] == ["body", "scenarioIds", 1]
    assert "voice" in by_id[no_voice["id"]]["msg"]
    assert "chat" in by_id[no_chat["id"]]["msg"]
    assert by_id[missing]["msg"] == "scenario not found"
    assert drive.started == []
    async with user_client._transport.app.state.sessionmaker() as db:  # nothing was created
        assert (await db.scalars(select(RunBatchRecord))).all() == []


async def test_launch_creates_a_batch_with_snapshots(user_client, factory, drive):
    first = await factory.scenario("First")
    second = await factory.scenario("Second")

    response = await launch(
        user_client, [first["id"], second["id"]], repetitions=2, concurrency=2, label="nightly"
    )

    assert response.status_code == 201, response.text
    batch = response.json()
    assert batch["label"] == "nightly"
    assert (batch["concurrency"], batch["total"]) == (2, 4)
    assert batch["status"] in {"queued", "running"}
    runs = batch["runs"]
    assert [run["scenarioId"] for run in runs] == [first["id"], second["id"]] * 2
    assert [run["position"] for run in runs] == [0, 1, 2, 3]
    assert len({run["threadId"] for run in runs}) == 4
    assert all(run["batchId"] == batch["id"] for run in runs)
    assert runs[0]["scenarioName"] == "First"
    assert runs[0]["agentName"] == "Vivi dev"

    # later edits never change what a run was launched with
    patched = await user_client.patch(f"/api/scenarios/{first['id']}", json={"goal": "Changed."})
    assert patched.status_code == 200
    detail = (await user_client.get(f"/api/runs/{runs[0]['id']}")).json()
    snapshot = detail["snapshot"]
    assert snapshot["scenario"]["goal"] == "Learn the current account balance."
    assert snapshot["agent"]["channelId"] == "channel-123"
    assert snapshot["brief"]["facts"] == [["account_number", "123-456"]]
    assert snapshot["connections"]["evaluator"]["chatModel"] == "gpt-6-luna"

    drive.release.set()
    await wait_for(all_in(user_client, [run["id"] for run in runs], TERMINAL))
    finished = (await user_client.get(f"/api/runs/batches/{batch['id']}")).json()
    assert finished["status"] == "completed"
    assert finished["counts"] == {"completed": 4}


async def test_batch_concurrency_is_respected(user_client, factory, drive):
    scenario = await factory.scenario()
    batch = (await launch(user_client, [scenario["id"]], repetitions=5, concurrency=2)).json()
    run_ids = [run["id"] for run in batch["runs"]]

    async def two_running() -> bool:
        return len(drive.started) == 2

    await wait_for(two_running)
    await asyncio.sleep(0.2)
    assert drive.max_active == 2
    statuses = [await run_status(user_client, run_id) for run_id in run_ids]
    assert statuses.count("running") == 2
    assert statuses.count("queued") == 3

    drive.release.set()
    await wait_for(all_in(user_client, run_ids, {"completed"}))
    assert drive.max_active == 2
    assert len(drive.started) == 5


async def test_the_global_cap_bounds_every_batch(app, user_client, factory, drive):
    app.state.runs.resize(3)
    scenario = await factory.scenario()
    for _ in range(2):
        response = await launch(user_client, [scenario["id"]], repetitions=3, concurrency=3)
        assert response.status_code == 201

    async def three_running() -> bool:
        return len(drive.started) == 3

    await wait_for(three_running)
    await asyncio.sleep(0.2)
    assert drive.max_active == 3
    drive.release.set()

    async def all_done() -> bool:
        return len(drive.started) == 6 and drive.active == 0

    await wait_for(all_done)
    assert drive.max_active == 3


async def test_cancel_a_running_and_a_queued_run(user_client, factory, drive):
    scenario = await factory.scenario()
    batch = (await launch(user_client, [scenario["id"]], repetitions=2, concurrency=1)).json()
    running, queued = [run["id"] for run in batch["runs"]]
    await wait_for(all_in(user_client, [running], {"running"}))

    for run_id in (queued, running):
        response = await user_client.post(f"/api/runs/{run_id}/cancel")
        assert response.status_code == 202, response.text
    await wait_for(all_in(user_client, [running, queued], {"cancelled"}))

    detail = (await user_client.get(f"/api/runs/{running}")).json()
    assert detail["endReason"] == "cancelled"
    assert detail["endedAt"] is not None
    assert drive.started == [running]
    again = await user_client.post(f"/api/runs/{running}/cancel")
    assert again.status_code == 409
    batch_after = (await user_client.get(f"/api/runs/batches/{batch['id']}")).json()
    assert batch_after["status"] == "completed"
    assert batch_after["counts"] == {"cancelled": 2}


async def test_cancel_a_batch(user_client, factory, drive):
    scenario = await factory.scenario()
    batch = (await launch(user_client, [scenario["id"]], repetitions=3, concurrency=1)).json()
    run_ids = [run["id"] for run in batch["runs"]]
    await wait_for(all_in(user_client, run_ids[:1], {"running"}))

    response = await user_client.post(f"/api/runs/batches/{batch['id']}/cancel")
    assert response.status_code == 202, response.text
    await wait_for(all_in(user_client, run_ids, {"cancelled"}))
    after = (await user_client.get(f"/api/runs/batches/{batch['id']}")).json()
    assert after["status"] == "cancelled"
    assert after["counts"] == {"cancelled": 3}
    assert len(drive.started) == 1
    assert (await user_client.post(f"/api/runs/batches/{batch['id']}/cancel")).status_code == 409


async def test_unknown_ids_are_404(user_client, drive):
    some = uuid.uuid4()
    for response in [
        await user_client.get(f"/api/runs/{some}"),
        await user_client.post(f"/api/runs/{some}/cancel"),
        await user_client.get(f"/api/runs/{some}/audio/agent"),
        await user_client.get(f"/api/runs/batches/{some}"),
        await user_client.post(f"/api/runs/batches/{some}/cancel"),
    ]:
        assert response.status_code == 404, response.text


async def test_list_filters_and_pagination(user_client, factory, drive):
    first = await factory.scenario("First")
    second = await factory.scenario("Second")
    old = (await launch(user_client, [first["id"]], repetitions=2)).json()
    new = (await launch(user_client, [second["id"]], repetitions=3)).json()
    drive.release.set()
    await wait_for(all_in(user_client, [r["id"] for r in old["runs"] + new["runs"]], TERMINAL))

    page = (await user_client.get("/api/runs", params={"limit": 2})).json()
    assert page["total"] == 5
    assert [item["batchId"] for item in page["items"]] == [new["id"], new["id"]]  # newest first
    rest = (await user_client.get("/api/runs", params={"limit": 10, "offset": 2})).json()
    assert len(rest["items"]) == 3
    ids = [item["id"] for item in page["items"] + rest["items"]]
    assert len(set(ids)) == 5

    by_scenario = (await user_client.get("/api/runs", params={"scenarioId": first["id"]})).json()
    assert {item["batchId"] for item in by_scenario["items"]} == {old["id"]}
    by_batch = (await user_client.get("/api/runs", params={"batchId": new["id"]})).json()
    assert by_batch["total"] == 3
    by_status = (await user_client.get("/api/runs", params={"status": "running"})).json()
    assert by_status == {"items": [], "total": 0}
    assert (await user_client.get("/api/runs", params={"status": "nope"})).status_code == 422
    assert (await user_client.get("/api/runs", params={"limit": 0})).status_code == 422

    batches = (await user_client.get("/api/runs/batches")).json()
    assert [item["id"] for item in batches["items"]] == [new["id"], old["id"]]


async def test_finished_run_detail_has_summary_transcript_and_audio(user_client, factory, drive):
    scenario = await factory.scenario()
    batch = (await launch(user_client, [scenario["id"]])).json()
    run_id = batch["runs"][0]["id"]
    drive.release.set()
    await wait_for(all_in(user_client, [run_id], {"completed"}))

    detail = (await user_client.get(f"/api/runs/{run_id}")).json()
    assert detail["endReason"] == "caller_hung_up"
    assert detail["summary"]["latenciesMs"] == [420.0]
    assert detail["summary"]["durationMs"] == 1234.5
    assert detail["transcript"] == [
        {"role": "agent", "text": "hello", "startMs": 0.0, "endMs": 400.0}
    ]
    assert detail["error"] is None

    audio = await user_client.get(f"/api/runs/{run_id}/audio/agent")
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/wav"
    assert audio.content == b"RIFF....WAVEfake"
    assert (await user_client.get(f"/api/runs/{run_id}/audio/caller")).status_code == 404
    assert (await user_client.get(f"/api/runs/{run_id}/audio/other")).status_code == 422


async def test_a_failed_run_keeps_a_short_sanitized_error(user_client, factory, drive):
    drive.result = {
        **drive.result,
        "status": "failed",
        "reason": "tts_failed",
        "error": "speech synthesis failed (\x1b[31mno audio\n" + "x" * 900 + ")",
    }
    scenario = await factory.scenario()
    run_id = (await launch(user_client, [scenario["id"]])).json()["runs"][0]["id"]
    drive.release.set()
    await wait_for(all_in(user_client, [run_id], {"failed"}))

    detail = (await user_client.get(f"/api/runs/{run_id}")).json()
    assert detail["endReason"] == "tts_failed"
    assert len(detail["error"]) <= 500
    assert detail["error"].startswith("speech synthesis failed (")
    assert "\x1b" not in detail["error"] and "\n" not in detail["error"]


async def test_setup_failure_fails_the_run_without_leaking(app, user_client, factory):
    scenario = await factory.scenario()

    async def broken_policy(db, connection_id):
        raise RuntimeError("secret sk-proj-abcdefghijklmnop leaked?")

    app.state.runs.build_policy = broken_policy
    run_id = (await launch(user_client, [scenario["id"]])).json()["runs"][0]["id"]
    await wait_for(all_in(user_client, [run_id], {"failed"}))

    detail = (await user_client.get(f"/api/runs/{run_id}")).json()
    assert detail["endReason"] == "setup_failed"
    assert "sk-proj" not in detail["error"]
    assert "RuntimeError" in detail["error"]


async def test_startup_marks_unfinished_runs_interrupted(app, user_client, factory, drive):
    scenario = await factory.scenario()
    batch = (await launch(user_client, [scenario["id"]], repetitions=3, concurrency=1)).json()
    run_ids = [run["id"] for run in batch["runs"]]
    await wait_for(all_in(user_client, run_ids[:1], {"running"}))
    # simulate a crash: forget the tasks, keep the rows as they were
    await app.state.runs.shutdown()
    async with app.state.sessionmaker() as db:
        await db.execute(
            update(RunRecord)
            .where(RunRecord.id == uuid.UUID(run_ids[0]))
            .values(status="running", end_reason=None, ended_at=None)
        )
        await db.execute(
            update(RunRecord)
            .where(RunRecord.id.in_([uuid.UUID(i) for i in run_ids[1:]]))
            .values(status="queued", end_reason=None, ended_at=None)
        )
        await db.execute(update(RunBatchRecord).values(status="running"))
        await db.commit()

    async with app.router.lifespan_context(app):
        for run_id in run_ids:
            detail = (await user_client.get(f"/api/runs/{run_id}")).json()
            assert (detail["status"], detail["endReason"]) == ("interrupted", "server_restarted")
        after = (await user_client.get(f"/api/runs/batches/{batch['id']}")).json()
        assert after["status"] == "completed"


async def test_shutdown_interrupts_running_runs(app, user_client, factory, drive):
    scenario = await factory.scenario()
    batch = (await launch(user_client, [scenario["id"]], repetitions=2, concurrency=1)).json()
    run_ids = [run["id"] for run in batch["runs"]]
    await wait_for(all_in(user_client, run_ids[:1], {"running"}))

    await app.state.runs.shutdown()

    for run_id in run_ids:
        detail = (await user_client.get(f"/api/runs/{run_id}")).json()
        assert (detail["status"], detail["endReason"]) == ("interrupted", "shutdown")


async def test_list_items_carry_persona_turns_and_median_latency(user_client, factory, drive):
    scenario = await factory.scenario()
    drive.result = {**drive.result, "latencies_ms": [300.0, 500.0, 420.4, 100.0]}
    done = (await launch(user_client, [scenario["id"]])).json()["runs"][0]["id"]
    drive.release.set()
    await wait_for(all_in(user_client, [done], {"completed"}))
    drive.release.clear()
    drive.result = {**drive.result, "latencies_ms": []}
    pending = (await launch(user_client, [scenario["id"]])).json()["runs"][0]["id"]
    await wait_for(all_in(user_client, [pending], {"running"}))

    items = {item["id"]: item for item in (await user_client.get("/api/runs")).json()["items"]}

    finished = items[done]
    assert finished["persona"] == "Lucía"
    assert (finished["callerTurns"], finished["agentTurns"]) == (1, 2)
    assert finished["latencyP50Ms"] == 360  # median of 100, 300, 420.4, 500
    running = items[pending]
    assert running["persona"] == "Lucía"
    assert (running["callerTurns"], running["agentTurns"], running["latencyP50Ms"]) == (
        None,
        None,
        None,
    )
    detail = (await user_client.get(f"/api/runs/{done}")).json()
    assert detail["latencyP50Ms"] == 360


async def test_list_items_tolerate_a_malformed_summary(app, user_client, factory, drive):
    scenario = await factory.scenario()
    run_id = (await launch(user_client, [scenario["id"]])).json()["runs"][0]["id"]
    drive.release.set()
    await wait_for(all_in(user_client, [run_id], {"completed"}))
    async with app.state.sessionmaker() as db:
        await db.execute(
            update(RunRecord)
            .where(RunRecord.id == uuid.UUID(run_id))
            .values(summary={"caller_turns": "x", "agent_turns": True, "latencies_ms": ["a", 5]})
        )
        await db.commit()

    item = (await user_client.get("/api/runs")).json()["items"][0]

    assert (item["callerTurns"], item["agentTurns"], item["latencyP50Ms"]) == (None, None, 5)

    async with app.state.sessionmaker() as db:
        await db.execute(  # huge finite values never break the list
            update(RunRecord)
            .where(RunRecord.id == uuid.UUID(run_id))
            .values(summary={"latencies_ms": [1e308, 1e308]})
        )
        await db.commit()

    response = await user_client.get("/api/runs")
    assert response.status_code == 200
    assert response.json()["items"][0]["latencyP50Ms"] >= 10**307


async def test_cancelling_a_run_that_finished_meanwhile_is_409(app, user_client, factory, drive):
    """The run ends on its own between the API's read and the cancel: 409, status kept."""
    scenario = await factory.scenario()
    batch = (await launch(user_client, [scenario["id"]], repetitions=2, concurrency=1)).json()
    live, orphan = [run["id"] for run in batch["runs"]]
    await wait_for(all_in(user_client, [live], {"running"}))
    manager = app.state.runs
    original = manager.cancel_run

    async def finish_first(run):
        async with app.state.sessionmaker() as db:
            await db.execute(
                update(RunRecord)
                .where(RunRecord.id == run.id)
                .values(status="completed", end_reason="caller_hung_up")
            )
            await db.commit()
        return await original(run)

    manager.cancel_run = finish_first
    # a live task: the cancel is requested, but the run had already completed
    response = await user_client.post(f"/api/runs/{live}/cancel")
    assert response.status_code == 409, response.text
    assert await run_status(user_client, live) == "completed"

    # no live task (the process forgot it): the guarded update records nothing
    manager.cancel_run = original
    await manager.shutdown()
    manager.cancel_run = finish_first
    async with app.state.sessionmaker() as db:
        await db.execute(
            update(RunRecord)
            .where(RunRecord.id == uuid.UUID(orphan))
            .values(status="running", end_reason=None, ended_at=None)
        )
        await db.commit()
    response = await user_client.post(f"/api/runs/{orphan}/cancel")
    assert response.status_code == 409, response.text
    assert await run_status(user_client, orphan) == "completed"
