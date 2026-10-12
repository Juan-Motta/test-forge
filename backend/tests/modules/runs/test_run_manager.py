"""The run manager end to end: real SessionRunner, in-process fake Live agent, fake policy and TTS.

The policy and the synthesizer factories are replaced on `app.state.runs`, so no provider is
ever contacted; the agent under test is the in-process `FakeLiveServer`.
"""

import uuid

from runs_support import wait_for
from sqlalchemy import select, update

from voice_eval.modules.agents.models import AgentRecord
from voice_eval.modules.runs.models import RunRecord
from voice_eval.ports.policy import CallerDecision, PolicyState
from voice_eval.runner.artifacts import ARTIFACT_NAMES

SPEECH = b"\x10\x00" * 2400 * 3  # 300 ms


class OneTurnPolicy:
    """Asks for a room once, then hangs up."""

    def __init__(self) -> None:
        self.states: list[PolicyState] = []

    async def next_turn(self, state: PolicyState) -> CallerDecision:
        self.states.append(state)
        if state.caller_turns == 0:
            return CallerDecision("I need a room", False, "opening")
        return CallerDecision(None, True, "goal met")


class FakeTts:
    def __init__(self) -> None:
        self.texts: list[str] = []

    async def synthesize(self, text: str) -> bytes:
        self.texts.append(text)
        return SPEECH

    async def stream(self, text: str):
        yield await self.synthesize(text)


async def test_a_batch_runs_end_to_end_against_the_fake_agent(
    app, user_client, factory, fake_live_server, settings
):
    policies: list[OneTurnPolicy] = []
    tts = FakeTts()
    built: list[tuple[str, uuid.UUID]] = []

    async def build_policy(db, connection_id):
        built.append(("policy", connection_id))
        policies.append(OneTurnPolicy())
        return policies[-1]

    async def build_synthesizer(db, connection_id, voice):
        built.append(("tts", connection_id))
        return tts

    manager = app.state.runs
    manager.build_policy = build_policy
    manager.build_synthesizer = build_synthesizer
    manager.session_overrides = {
        "silence_gap_ms": 300,
        "settle_ms": 300,
        "playback_grace_ms": 50,
    }
    scenario = await factory.scenario()
    async with app.state.sessionmaker() as db:  # point the stored agent at the in-process fake
        await db.execute(update(AgentRecord).values(base_url=fake_live_server.url))
        await db.commit()

    response = await user_client.post(
        "/api/runs", json={"scenarioIds": [scenario["id"]], "repetitions": 3, "concurrency": 2}
    )
    assert response.status_code == 201, response.text
    run_ids = [run["id"] for run in response.json()["runs"]]

    async def all_completed() -> bool:
        statuses = [(await user_client.get(f"/api/runs/{i}")).json()["status"] for i in run_ids]
        return statuses == ["completed"] * 3

    await wait_for(all_completed, within_s=60)

    openai = uuid.UUID(await factory.openai())
    assert sorted(built) == sorted([("policy", openai), ("tts", openai)] * 3)
    assert tts.texts == ["I need a room"] * 3
    assert all(len(policy.states) == 2 for policy in policies)
    assert policies[0].states[0].brief.goal == "Learn the current account balance."

    async with app.state.sessionmaker() as db:
        records = (await db.scalars(select(RunRecord).order_by(RunRecord.position))).all()
    thread_ids = {record.thread_id for record in records}
    assert len(thread_ids) == 3
    for record in records:
        assert (record.status, record.end_reason) == ("completed", "caller_hung_up")
        assert record.started_at is not None and record.ended_at >= record.started_at
        assert record.summary["thread_id"] == record.thread_id
        assert record.summary["caller_turns"] == 1
        assert record.summary["latencies_ms"]
        out = settings.runs_data_dir / str(record.id)
        assert record.artifacts_dir == str(out)
        for name in ARTIFACT_NAMES:
            assert (out / name).stat().st_size > 0, name
    # the fake agent saw each run's own threadId in its URL
    assert all(any(t in path for path in fake_live_server.paths) for t in thread_ids)

    detail = (await user_client.get(f"/api/runs/{run_ids[0]}")).json()
    assert [row["role"] for row in detail["transcript"]] == ["agent", "caller", "agent"]
    audio = await user_client.get(f"/api/runs/{run_ids[0]}/audio/caller")
    assert audio.status_code == 200
    assert audio.content[:4] == b"RIFF"
    batch = (await user_client.get(f"/api/runs/batches/{detail['batchId']}")).json()
    assert (batch["status"], batch["counts"]) == ("completed", {"completed": 3})
