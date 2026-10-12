"""Re-run: a new batch of one run of the same scenario, launched like `POST /api/runs`.

Every run is driven by a fake (`BlockingDrive`): no agent or provider is ever contacted.
"""

import uuid

from runs_support import insert_run, wait_for

TERMINAL = {"completed", "failed", "cancelled", "interrupted"}


async def finished_run(user_client, factory, drive) -> dict:
    scenario = await factory.scenario()
    launched = await user_client.post(
        "/api/runs", json={"scenarioIds": [scenario["id"]], "repetitions": 2, "concurrency": 2}
    )
    assert launched.status_code == 201, launched.text
    run = launched.json()["runs"][0]
    drive.release.set()

    async def done() -> bool:
        return (await user_client.get(f"/api/runs/{run['id']}")).json()["status"] in TERMINAL

    await wait_for(done)
    return run


async def test_rerun_requires_authentication(client):
    assert (await client.post(f"/api/runs/{uuid.uuid4()}/rerun")).status_code == 401


async def test_rerun_of_an_unknown_run_is_404(user_client):
    response = await user_client.post(f"/api/runs/{uuid.uuid4()}/rerun")
    assert response.status_code == 404


async def test_rerun_launches_one_run_of_the_same_scenario(user_client, factory, drive):
    run = await finished_run(user_client, factory, drive)
    response = await user_client.post(f"/api/runs/{run['id']}/rerun")
    assert response.status_code == 201, response.text
    batch = response.json()
    assert batch["label"] == f"Re-run of {run['id'][:8]}"
    assert (batch["total"], batch["concurrency"]) == (1, 1)
    assert batch["id"] != run["batchId"]
    [rerun] = batch["runs"]
    assert rerun["scenarioId"] == run["scenarioId"]
    assert rerun["id"] != run["id"]

    async def done() -> bool:
        return (await user_client.get(f"/api/runs/{rerun['id']}")).json()["status"] in TERMINAL

    await wait_for(done)


async def test_rerun_of_a_deleted_scenario_is_409(app, user_client):
    run_id = await insert_run(app.state.sessionmaker)  # scenario_id is null: it was deleted
    response = await user_client.post(f"/api/runs/{run_id}/rerun")
    assert response.status_code == 409
    assert response.json()["detail"] == "The scenario of this run was deleted"


async def test_rerun_of_a_scenario_that_cannot_run_is_422_like_launch(user_client, factory, drive):
    run = await finished_run(user_client, factory, drive)
    scenario_id = run["scenarioId"]
    cleared = await user_client.patch(
        f"/api/scenarios/{scenario_id}", json={"ttsConnectionId": None}
    )
    assert cleared.status_code == 200, cleared.text
    response = await user_client.post(f"/api/runs/{run['id']}/rerun")
    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert error["scenarioId"] == scenario_id
    assert "voice" in error["msg"]
