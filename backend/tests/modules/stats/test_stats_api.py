"""Overview stats: runs, scores, goal completion, latency, live runs, weakest criteria and
suggestions over a window of days. Runs and judgements are written straight to the database."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from voice_eval.modules.judgements.models import RunJudgementRecord
from voice_eval.modules.runs.models import RunBatchRecord, RunRecord

NOW = datetime.now(UTC)
FIELDS = {
    "periodDays", "runs", "averageScore", "goalCompletion", "latency", "live",
    "weakestCriteria", "suggestions", "spend",
}  # fmt: skip


def criterion(text: str, score: int | None) -> dict[str, Any]:
    return {"criterionId": str(uuid.uuid4()), "text": text, "score": score}


def result(
    score: int | None,
    *,
    must_failed: bool = False,
    criteria: list[dict[str, Any]] = (),
    priorities: tuple[str, ...] = (),
) -> dict[str, Any]:
    return {
        "overallScore": score,
        "mustFailed": must_failed,
        "criteria": list(criteria),
        "suggestions": [{"title": "t", "priority": p} for p in priorities],
    }


async def add_run(
    app,
    *,
    age: timedelta = timedelta(hours=1),
    status: str = "completed",
    scenario_id: uuid.UUID | None = None,
    scenario_name: str = "Balance",
    latencies: list[Any] | None = None,
    judgement: dict[str, Any] | None = None,
    judgement_status: str = "completed",
    caller_usage: dict[str, Any] | None = None,
    judge_usage: dict[str, Any] | None = None,
) -> uuid.UUID:
    run_id, batch_id = uuid.uuid4(), uuid.uuid4()
    scenario = scenario_id or uuid.uuid4()
    async with app.state.sessionmaker() as db:
        db.add(RunBatchRecord(id=batch_id, concurrency=1, status="completed", total_runs=1))
        await db.flush()
        db.add(
            RunRecord(
                id=run_id,
                batch_id=batch_id,
                position=0,
                thread_id="thread",
                status=status,
                snapshot={"scenario": {"id": str(scenario), "name": scenario_name}},
                summary={
                    **({"latencies_ms": latencies} if latencies is not None else {}),
                    **({"usage": caller_usage} if caller_usage is not None else {}),
                }
                or None,
                created_at=NOW - age,
            )
        )
        if judgement is not None or judgement_status != "completed" or judge_usage is not None:
            await db.flush()
            db.add(
                RunJudgementRecord(
                    run_id=run_id,
                    status=judgement_status,
                    result=judgement if judgement_status == "completed" else None,
                    usage=judge_usage,
                )
            )
        await db.commit()
    return run_id


async def test_stats_require_authentication(client):
    assert (await client.get("/api/stats/overview")).status_code == 401


@pytest.mark.parametrize("days", [0, 91])
async def test_days_are_bounded(user_client, days):
    assert (await user_client.get(f"/api/stats/overview?days={days}")).status_code == 422


async def test_an_empty_window_has_null_aggregates(user_client):
    response = await user_client.get("/api/stats/overview")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "periodDays": 7,
        "runs": {"count": 0, "previousCount": 0},
        "averageScore": None,
        "goalCompletion": None,
        "latency": {"p50Ms": None, "p95Ms": None},
        "live": {"active": 0},
        "weakestCriteria": [],
        "suggestions": {"open": 0, "highPriority": 0},
        "spend": {"totalUsd": None, "previousTotalUsd": None, "complete": True},
    }


async def test_runs_without_judgements_count_but_do_not_score(app, user_client):
    await add_run(app, latencies=[100, 300, "bad", None])
    await add_run(app, judgement_status="judging")
    body = (await user_client.get("/api/stats/overview")).json()
    assert body["runs"] == {"count": 2, "previousCount": 0}
    assert (body["averageScore"], body["goalCompletion"]) == (None, None)
    assert body["latency"] == {"p50Ms": 200, "p95Ms": 290}


async def test_overview_aggregates_the_window(app, user_client):
    balance, refund = uuid.uuid4(), uuid.uuid4()
    await add_run(
        app,
        scenario_id=balance,
        latencies=[400, 600],
        judgement=result(
            80,
            criteria=[criterion("States the balance", 60), criterion("Greets", 100)],
            priorities=("high", "low"),
        ),
    )
    await add_run(
        app,
        scenario_id=balance,
        latencies=[800],
        judgement=result(
            40,
            must_failed=True,
            criteria=[criterion("States the balance", 20), criterion("Greets", None)],
            priorities=("high",),
        ),
    )
    await add_run(
        app,
        scenario_id=refund,
        scenario_name="Refund",
        judgement=result(None, criteria=[criterion("States the balance", 90)]),
    )
    await add_run(app, status="running")
    await add_run(app, status="queued", age=timedelta(days=30))  # live, outside the window
    await add_run(app, age=timedelta(days=8), judgement=result(0, must_failed=True))  # previous
    await add_run(app, age=timedelta(days=20), judgement=result(0))  # neither window

    body = (await user_client.get("/api/stats/overview?days=7")).json()
    assert set(body) == FIELDS
    assert body["periodDays"] == 7
    assert body["runs"] == {"count": 4, "previousCount": 1}
    assert body["averageScore"] == 60.0  # (80 + 40) / 2: the unscored judgement is left out
    assert body["goalCompletion"] == pytest.approx(2 / 3, abs=1e-3)
    assert body["latency"] == {"p50Ms": 600, "p95Ms": 780}
    assert body["live"] == {"active": 2}
    assert body["weakestCriteria"] == [
        {"text": "States the balance", "scenarioName": "Balance", "averageScore": 40.0,
         "judged": 2},
        {"text": "States the balance", "scenarioName": "Refund", "averageScore": 90.0,
         "judged": 1},
        {"text": "Greets", "scenarioName": "Balance", "averageScore": 100.0, "judged": 1},
    ]  # fmt: skip
    assert body["suggestions"] == {"open": 3, "highPriority": 2}


async def test_weakest_criteria_are_the_lowest_five(app, user_client):
    scenario = uuid.uuid4()
    await add_run(
        app,
        scenario_id=scenario,
        judgement=result(50, criteria=[criterion(f"C{i}", i * 10) for i in range(7)]),
    )
    body = (await user_client.get("/api/stats/overview?days=1")).json()
    assert [row["text"] for row in body["weakestCriteria"]] == ["C0", "C1", "C2", "C3", "C4"]
    assert body["periodDays"] == 1


def usage(**buckets: int) -> dict[str, Any]:
    return {"by_model": {"gpt-6-luna": buckets}}


async def test_spend_sums_the_evaluator_and_judge_cost_of_each_window(app, user_client):
    # Seeded list prices for gpt-6-luna: $0.10 per 1M input tokens, $0.50 per 1M output tokens.
    await add_run(app, caller_usage=usage(text_in=1_000_000), judge_usage=usage(text_out=1_000_000))
    await add_run(app, caller_usage=usage(text_in=2_000_000))
    await add_run(app)  # recorded before usage existed: no cost, not counted
    await add_run(app, age=timedelta(days=8), caller_usage=usage(text_out=1_000_000))
    body = (await user_client.get("/api/stats/overview")).json()
    assert body["spend"] == {"totalUsd": 0.8, "previousTotalUsd": 0.5, "complete": True}


async def test_spend_is_incomplete_when_some_usage_has_no_price(app, user_client):
    await add_run(app, caller_usage={"by_model": {"unpriced-model": {"text_in": 1000}}})
    body = (await user_client.get("/api/stats/overview")).json()
    assert body["spend"]["complete"] is False
