"""Runtime resolver: OpenAI and Azure OpenAI (with a chat deployment) connections build a judge."""

import uuid

import pytest
from openai import AsyncAzureOpenAI, AsyncOpenAI

from voice_eval.modules.connections.domain import ConnectionNotFound, UnsupportedConnection
from voice_eval.modules.connections.runtime import build_judge
from voice_eval.providers.openai_chat import OpenAIJudge

KEY = "sk-judge-runtime-abcdefghijkl"
AZURE = {
    "endpoint": "https://res.openai.azure.com",
    "apiVersion": "2025-03-01-preview",
    "ttsDeployment": "my-tts",
}


async def create(client, payload):
    response = await client.post("/api/connections", json=payload)
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def build(app, connection_id):
    async with app.state.sessionmaker() as session:
        return await build_judge(session, connection_id, secret_box=app.state.secret_box)


async def test_openai_connection_judges_with_gpt_6_luna(app, user_client):
    connection_id = await create(
        user_client, {"name": "chat", "kind": "openai", "config": {}, "secrets": {"apiKey": KEY}}
    )
    judge = await build(app, connection_id)
    assert isinstance(judge, OpenAIJudge)
    assert isinstance(judge.client, AsyncOpenAI)
    assert judge.model == "gpt-6-luna"
    assert judge.client.api_key == KEY


async def test_azure_connection_judges_with_its_chat_deployment(app, user_client):
    connection_id = await create(
        user_client,
        {"name": "azure", "kind": "azure_openai", "config": AZURE, "secrets": {"apiKey": KEY}},
    )
    with pytest.raises(
        UnsupportedConnection, match="no chat deployment: set one to use it as the judge"
    ):
        await build(app, connection_id)
    await user_client.patch(
        f"/api/connections/{connection_id}", json={"config": {**AZURE, "chatDeployment": "chat"}}
    )
    judge = await build(app, connection_id)
    assert isinstance(judge.client, AsyncAzureOpenAI)
    assert judge.model == "chat"
    assert judge.usage_model == "gpt-6-luna"


async def test_kinds_without_chat_cannot_judge(app, user_client):
    connection_id = await create(
        user_client,
        {
            "name": "lf",
            "kind": "langfuse",
            "config": {"host": "https://cloud.langfuse.com", "publicKey": "pk-lf-1"},
            "secrets": {"secretKey": KEY},
        },
    )
    with pytest.raises(UnsupportedConnection, match="cannot act as the judge"):
        await build(app, connection_id)
    with pytest.raises(ConnectionNotFound):
        await build(app, uuid.uuid4())
