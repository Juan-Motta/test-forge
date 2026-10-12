"""Run lists carry `mustFailed` from a completed judgement's result (null otherwise)."""

from runs_support import insert_run

from voice_eval.modules.judgements.models import RunJudgementRecord


async def test_runs_carry_must_failed_only_from_a_completed_judgement(app, user_client):
    sessionmaker = app.state.sessionmaker
    judgements = {
        "failed_must": ("completed", {"overallScore": 80, "mustFailed": True}),
        "passed_must": ("completed", {"overallScore": 40, "mustFailed": False}),
        "malformed": ("completed", {"overallScore": 70, "mustFailed": "yes"}),
        "missing": ("completed", {"overallScore": 70}),
        "judging": ("judging", {"mustFailed": True}),
    }
    ids = {label: await insert_run(sessionmaker) for label in judgements}
    ids["untouched"] = await insert_run(sessionmaker)
    async with sessionmaker() as db:
        for label, (status, result) in judgements.items():
            db.add(RunJudgementRecord(run_id=ids[label], status=status, result=result))
        await db.commit()

    response = await user_client.get("/api/runs")
    assert response.status_code == 200, response.text
    items = {item["id"]: item for item in response.json()["items"]}
    observed = {label: items[str(run_id)]["mustFailed"] for label, run_id in ids.items()}
    assert observed == {
        "failed_must": True,
        "passed_must": False,
        "malformed": None,
        "missing": None,
        "judging": None,
        "untouched": None,
    }
    detail = (await user_client.get(f"/api/runs/{ids['failed_must']}")).json()
    assert (detail["score"], detail["mustFailed"]) == (80, True)
