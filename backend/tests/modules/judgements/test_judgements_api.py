"""Judgements API: shapes, authentication, re-judge conflicts, and the score in the runs list.

Runs are written straight to the database and judged with the fakes of `harness`.
"""

import asyncio
import uuid

from judgements_support import insert_run, settled, snapshot

FIELDS = {
    "status",
    "result",
    "traceStats",
    "traceNote",
    "error",
    "model",
    "attempt",
    "createdAt",
    "updatedAt",
    "completedAt",
}


async def test_requires_authentication(client):
    some = uuid.uuid4()
    assert (await client.get(f"/api/runs/{some}/judgement")).status_code == 401
    assert (await client.post(f"/api/runs/{some}/judgement")).status_code == 401


async def test_unknown_runs_are_404(user_client, harness):
    some = uuid.uuid4()
    assert (await user_client.get(f"/api/runs/{some}/judgement")).status_code == 404
    assert (await user_client.post(f"/api/runs/{some}/judgement")).status_code == 404


async def test_a_run_never_judged_has_status_none(app, user_client, harness):
    run_id = await insert_run(app.state.sessionmaker)
    response = await user_client.get(f"/api/runs/{run_id}/judgement")
    assert response.status_code == 200
    assert response.json() == {"status": "none"}


async def test_rejudge_then_read_the_judgement(app, user_client, harness):
    run_id = await insert_run(app.state.sessionmaker, data=snapshot(langfuse=None))
    harness.model.gate = asyncio.Event()

    started = await user_client.post(f"/api/runs/{run_id}/judgement")
    assert started.status_code == 202, started.text
    body = started.json()
    assert set(body) == FIELDS
    assert (body["status"], body["attempt"], body["result"]) == ("pending", 1, None)

    busy = await user_client.post(f"/api/runs/{run_id}/judgement")
    assert busy.status_code == 409
    assert busy.json()["detail"] == "Judgement already in progress"

    harness.model.gate.set()
    await settled(app.state.judgements, run_id)
    judgement = (await user_client.get(f"/api/runs/{run_id}/judgement")).json()
    assert set(judgement) == FIELDS
    assert judgement["status"] == "completed"
    assert judgement["traceNote"] == "This agent has no Langfuse connection."
    assert judgement["model"] == "gpt-6-luna"
    assert judgement["completedAt"] is not None
    result = judgement["result"]
    assert result["overallScore"] == 70
    assert {"criteria", "suggestions", "brief", "mustFailed"} <= set(result)
    assert result["criteria"][0]["criterionId"] == snapshot()["scenario"]["criteria"][0]["id"]

    again = await user_client.post(f"/api/runs/{run_id}/judgement")
    assert (again.status_code, again.json()["attempt"]) == (202, 2)
    await settled(app.state.judgements, run_id)


async def test_an_active_run_cannot_be_judged(app, user_client, harness):
    run_id = await insert_run(app.state.sessionmaker, status="running")
    response = await user_client.post(f"/api/runs/{run_id}/judgement")
    assert response.status_code == 409
    assert response.json()["detail"] == "Run still in progress"
    assert (await user_client.get(f"/api/runs/{run_id}/judgement")).json() == {"status": "none"}


async def test_rejudge_from_a_foreign_origin_is_refused(app, user_client, harness):
    run_id = await insert_run(app.state.sessionmaker)
    response = await user_client.post(
        f"/api/runs/{run_id}/judgement", headers={"Origin": "https://evil.example.com"}
    )
    assert response.status_code == 403
    assert (await user_client.get(f"/api/runs/{run_id}/judgement")).json() == {"status": "none"}


async def test_runs_carry_their_judgement_status_and_score(app, user_client, harness):
    sessionmaker = app.state.sessionmaker
    judged = await insert_run(sessionmaker, data=snapshot(langfuse=None))
    in_progress = await insert_run(sessionmaker, data=snapshot(langfuse=None))
    untouched = await insert_run(sessionmaker)
    await app.state.judgements.schedule(judged)
    await settled(app.state.judgements, judged)
    harness.model.gate = asyncio.Event()
    await app.state.judgements.schedule(in_progress)

    items = {item["id"]: item for item in (await user_client.get("/api/runs")).json()["items"]}
    assert (items[str(judged)]["judgementStatus"], items[str(judged)]["score"]) == (
        "completed",
        70,
    )
    assert items[str(in_progress)]["judgementStatus"] in {"pending", "judging"}
    assert items[str(in_progress)]["score"] is None
    assert (items[str(untouched)]["judgementStatus"], items[str(untouched)]["score"]) == (
        None,
        None,
    )
    detail = (await user_client.get(f"/api/runs/{judged}")).json()
    assert (detail["judgementStatus"], detail["score"]) == ("completed", 70)

    harness.model.gate.set()
    await settled(app.state.judgements, in_progress)
