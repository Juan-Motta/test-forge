"""Text agents cannot be launched until the text runner exists; voice launches are unchanged."""

from runs_support import scenario_body
from sqlalchemy import select

from voice_eval.modules.runs.models import RunBatchRecord

TEXT_AGENT = {
    "name": "Vivi chat",
    "kind": "text",
    "baseUrl": "https://vivi.example.com",
    "channelId": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
}


async def test_launching_a_text_agent_is_refused_clearly(user_client, factory, drive):
    agent = await factory.post("/api/agents", TEXT_AGENT)
    scenario = await factory.post(
        "/api/scenarios",
        scenario_body(agent["id"], "Chat balance", ttsConnectionId=await factory.openai()),
    )
    voice = await factory.scenario("Voice balance")

    response = await user_client.post(
        "/api/runs", json={"scenarioIds": [voice["id"], scenario["id"]]}
    )

    assert response.status_code == 422, response.text
    (error,) = response.json()["detail"]
    assert error["scenarioId"] == scenario["id"]
    assert error["loc"] == ["body", "scenarioIds", 1]
    assert error["msg"] == "Text agents cannot be run yet"
    assert drive.started == []
    async with user_client._transport.app.state.sessionmaker() as db:
        assert (await db.scalars(select(RunBatchRecord))).all() == []
