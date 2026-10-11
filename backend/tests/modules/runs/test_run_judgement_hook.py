"""Runs and their judgements: the snapshot keeps the agent's Langfuse connection, and the manager
hands a run to the judge only when it is worth judging (a recording scheduler stands in)."""

import uuid

import pytest
from runs_support import summary_for, wait_for


class RecordingScheduler:
    def __init__(self) -> None:
        self.scheduled: list[str] = []

    async def schedule(self, run_id: uuid.UUID) -> None:
        self.scheduled.append(str(run_id))


@pytest.fixture
def scheduler(app) -> RecordingScheduler:
    recorder = RecordingScheduler()
    app.state.runs.judgements = recorder
    return recorder


async def launch_one(client, factory) -> str:
    """One run of the factory's single scenario (created on first use)."""
    if not hasattr(factory, "scenario_id"):
        factory.scenario_id = (await factory.scenario())["id"]
    response = await client.post("/api/runs", json={"scenarioIds": [factory.scenario_id]})
    assert response.status_code == 201, response.text
    return response.json()["runs"][0]["id"]


def status_is(client, run_id: str, expected: str):
    async def check() -> bool:
        return (await client.get(f"/api/runs/{run_id}")).json()["status"] == expected

    return check


async def test_the_snapshot_keeps_the_agent_langfuse_connection(
    user_client, factory, drive, scheduler
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
    unlinked = await launch_one(user_client, factory)
    agent_id = await factory.agent()
    patched = await user_client.patch(
        f"/api/agents/{agent_id}", json={"langfuseConnectionId": langfuse_id}
    )
    assert patched.status_code == 200, patched.text
    linked = await launch_one(user_client, factory)

    def agent_block(run_id: str):
        async def read() -> dict:
            return (await user_client.get(f"/api/runs/{run_id}")).json()["snapshot"]["agent"]

        return read

    assert (await agent_block(unlinked)())["langfuseConnectionId"] is None
    assert (await agent_block(linked)())["langfuseConnectionId"] == langfuse_id
    drive.release.set()


async def test_a_completed_run_is_handed_to_the_judge(user_client, factory, drive, scheduler):
    run_id = await launch_one(user_client, factory)
    drive.release.set()
    await wait_for(status_is(user_client, run_id, "completed"))
    await wait_for(lambda: _true(scheduler.scheduled == [run_id]))


async def test_a_failed_run_is_judged_only_if_the_agent_spoke(
    user_client, factory, drive, scheduler
):
    drive.result = {**summary_for("failed", "agent_closed"), "agent_turns": 1}
    spoke = await launch_one(user_client, factory)
    drive.release.set()
    await wait_for(status_is(user_client, spoke, "failed"))
    await wait_for(lambda: _true(scheduler.scheduled == [spoke]))

    drive.result = {**summary_for("failed", "connect_failed"), "agent_turns": 0}
    silent = await launch_one(user_client, factory)
    await wait_for(status_is(user_client, silent, "failed"))
    assert scheduler.scheduled == [spoke]


async def test_cancelled_runs_are_not_judged(user_client, factory, drive, scheduler):
    run_id = await launch_one(user_client, factory)
    await wait_for(status_is(user_client, run_id, "running"))
    assert (await user_client.post(f"/api/runs/{run_id}/cancel")).status_code == 202
    await wait_for(status_is(user_client, run_id, "cancelled"))
    assert scheduler.scheduled == []


async def test_a_scheduler_failure_never_breaks_the_run(app, user_client, factory, drive):
    class Broken:
        async def schedule(self, run_id: uuid.UUID) -> None:
            raise RuntimeError("database gone")

    app.state.runs.judgements = Broken()
    run_id = await launch_one(user_client, factory)
    drive.release.set()
    await wait_for(status_is(user_client, run_id, "completed"))


async def test_the_app_judges_finished_runs_offline_in_tests(app, user_client, factory, drive):
    """Wired for real: the coordinator gets the run and, with no provider in tests, fails it."""
    run_id = await launch_one(user_client, factory)
    drive.release.set()
    await wait_for(status_is(user_client, run_id, "completed"))

    async def judged() -> bool:
        body = (await user_client.get(f"/api/runs/{run_id}/judgement")).json()
        return body["status"] == "failed"

    await wait_for(judged)
    body = (await user_client.get(f"/api/runs/{run_id}/judgement")).json()
    assert body["error"] == "the evaluator connection could not be used (RuntimeError)"
    assert body["traceNote"] == "This agent has no Langfuse connection."


async def _true(value: bool) -> bool:
    return value
