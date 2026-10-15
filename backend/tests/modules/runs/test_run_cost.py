"""Runs carry the evaluator's approximate cost: caller usage (summary) + judge usage, priced."""

import pytest
from runs_support import insert_run

from voice_eval.modules.judgements.models import RunJudgementRecord

CALLER = {"by_model": {"gpt-realtime-2.1-mini": {"audio_in": 1_000_000, "audio_out": 500_000}}}
JUDGE = {"by_model": {"gpt-6-luna": {"text_in": 1_000_000, "text_out": 1_000_000}}}


async def test_a_run_costs_its_caller_and_every_judgement_attempt(app, user_client):
    sessionmaker = app.state.sessionmaker
    run_id = await insert_run(sessionmaker, summary={"caller_turns": 2, "usage": CALLER})
    async with sessionmaker() as db:
        db.add(
            RunJudgementRecord(
                run_id=run_id, status="completed", result={"overallScore": 70}, usage=JUDGE
            )
        )
        await db.commit()

    detail = (await user_client.get(f"/api/runs/{run_id}")).json()
    cost = detail["cost"]
    assert cost["callerUsd"] == pytest.approx(20.0)  # 10 audio in + 10 audio out
    assert cost["judgeUsd"] == pytest.approx(0.6)
    assert cost["totalUsd"] == pytest.approx(20.6)
    assert cost["complete"] is True
    assert cost["notes"] == []
    assert cost["breakdown"] == [
        {"part": "caller", "model": "gpt-realtime-2.1-mini", "usd": pytest.approx(20.0)},
        {"part": "judge", "model": "gpt-6-luna", "usd": pytest.approx(0.6)},
    ]
    listed = (await user_client.get("/api/runs")).json()["items"]
    assert listed[0]["cost"]["totalUsd"] == pytest.approx(20.6)


async def test_runs_without_usage_have_no_cost(app, user_client):
    run_id = await insert_run(app.state.sessionmaker, summary={"caller_turns": 1})
    assert (await user_client.get(f"/api/runs/{run_id}")).json()["cost"] is None
    assert (await user_client.get("/api/runs")).json()["items"][0]["cost"] is None
