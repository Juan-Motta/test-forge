"""Trace waterfall of a run: the agent's Langfuse observations saved by the judge
(`langfuse.json`), as offsets from the run start with their nesting depth."""

import json
import uuid
from datetime import UTC, datetime, timedelta

from runs_support import insert_run

from voice_eval.modules.runs.trace import build_trace

STARTED = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)
OBSERVATION_FIELDS = {
    "id", "traceId", "parentId", "type", "name", "startMs", "durationMs", "model", "tokens",
    "costUsd", "level", "statusMessage", "depth",
}  # fmt: skip


def at(ms: int) -> str:
    return (STARTED + timedelta(milliseconds=ms)).isoformat()


OBSERVATIONS = [
    {"id": "gen", "traceId": "t1", "parentObservationId": "root", "type": "GENERATION",
     "name": "llm", "startTime": at(1200), "endTime": at(2000), "model": "gpt-x",
     "usageDetails": {"input": 100, "output": 20}, "calculatedTotalCost": 0.0012},
    {"id": "root", "traceId": "t1", "type": "SPAN", "name": "turn", "startTime": at(1000),
     "endTime": at(3000)},
    {"id": "tool", "traceId": "t1", "parentObservationId": "gen", "type": "TOOL",
     "name": "get_balance", "startTime": at(1500), "endTime": at(1700), "level": "ERROR",
     "statusMessage": "timeout"},
    {"id": "evt", "traceId": "t1", "parentObservationId": "root", "type": "EVENT",
     "name": "barge-in", "startTime": at(2500)},
]  # fmt: skip


def test_observations_become_a_sorted_waterfall_with_depths():
    trace = build_trace(OBSERVATIONS, origin=STARTED)
    assert trace["available"] is True
    assert trace["note"] is None
    rows = trace["observations"]
    assert [row["id"] for row in rows] == ["root", "gen", "tool", "evt"]
    assert all(set(row) == OBSERVATION_FIELDS for row in rows)
    root, gen, tool, evt = rows
    assert (root["type"], root["depth"], root["parentId"]) == ("span", 0, None)
    assert (root["startMs"], root["durationMs"]) == (1000, 2000)
    assert (gen["type"], gen["depth"], gen["model"], gen["tokens"]) == ("llm", 1, "gpt-x", 120)
    assert gen["costUsd"] == 0.0012
    assert (tool["type"], tool["depth"], tool["level"], tool["statusMessage"]) == (
        "tool", 2, "ERROR", "timeout",
    )  # fmt: skip
    assert (evt["type"], evt["depth"], evt["durationMs"]) == ("event", 1, None)
    assert root["level"] == "DEFAULT"
    stats = trace["stats"]
    assert stats["observationCount"] == 4
    assert stats["errorCount"] == 1
    assert stats["totalTokens"] == 120
    assert stats["models"] == ["gpt-x"]


def test_without_a_run_start_offsets_are_from_the_first_observation():
    rows = build_trace(OBSERVATIONS, origin=None)["observations"]
    assert rows[0]["startMs"] == 0
    assert rows[1]["startMs"] == 200


def test_unknown_parents_and_cycles_stay_shallow():
    rows = build_trace(
        [
            {"id": "a", "parentObservationId": "b", "startTime": at(0)},
            {"id": "b", "parentObservationId": "a", "startTime": at(10)},
            {"id": "c", "parentObservationId": "gone", "startTime": at(20), "type": "agent"},
            "not an observation",
        ],
        origin=STARTED,
    )["observations"]
    assert [row["id"] for row in rows] == ["a", "b", "c"]
    assert rows[2]["depth"] == 0
    assert rows[2]["type"] == "agent"
    assert all(row["depth"] <= 2 for row in rows)


def test_no_observations_is_unavailable_with_a_note():
    trace = build_trace(None, origin=STARTED, note="This agent has no Langfuse connection.")
    assert trace == {
        "available": False,
        "note": "This agent has no Langfuse connection.",
        "stats": None,
        "observations": [],
    }


# --- API ------------------------------------------------------------------------------------


async def test_trace_requires_authentication(client):
    assert (await client.get(f"/api/runs/{uuid.uuid4()}/trace")).status_code == 401


async def test_trace_of_an_unknown_run_is_404(user_client):
    assert (await user_client.get(f"/api/runs/{uuid.uuid4()}/trace")).status_code == 404


async def test_trace_of_a_run_from_its_saved_observations(app, user_client, tmp_path):
    out = tmp_path / "artifacts"
    out.mkdir()
    (out / "langfuse.json").write_text(json.dumps(OBSERVATIONS))
    run_id = await insert_run(app.state.sessionmaker, artifacts_dir=out, started_at=STARTED)
    response = await user_client.get(f"/api/runs/{run_id}/trace")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"available", "note", "stats", "observations"}
    assert body["available"] is True
    assert [row["startMs"] for row in body["observations"]] == [1000, 1200, 1500, 2500]


async def test_trace_without_saved_observations_is_unavailable(app, user_client):
    run_id = await insert_run(app.state.sessionmaker)
    body = (await user_client.get(f"/api/runs/{run_id}/trace")).json()
    assert body["available"] is False
    assert body["observations"] == []
    assert "Langfuse" in body["note"]


async def test_trace_of_a_run_in_progress_is_unavailable(app, user_client):
    run_id = await insert_run(app.state.sessionmaker, status="running")
    body = (await user_client.get(f"/api/runs/{run_id}/trace")).json()
    assert (body["available"], body["note"]) == (False, "The run is still in progress.")


async def test_trace_with_no_usable_observations_is_unavailable_with_a_note(
    app, user_client, tmp_path
):
    out = tmp_path / "artifacts"
    out.mkdir()
    (out / "langfuse.json").write_text(json.dumps(["not an observation", 42, None]))
    run_id = await insert_run(app.state.sessionmaker, artifacts_dir=out, started_at=STARTED)
    body = (await user_client.get(f"/api/runs/{run_id}/trace")).json()
    assert (body["available"], body["observations"]) == (False, [])
    assert body["note"] and "Langfuse" in body["note"]
