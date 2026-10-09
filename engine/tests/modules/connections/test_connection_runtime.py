"""Runtime resolver: every run builds its provider from the connection as stored right now."""

import uuid

import pytest
from openai import AsyncAzureOpenAI

from voice_eval.modules.connections.domain import ConnectionNotFound, UnsupportedConnection
from voice_eval.modules.connections.runtime import build_synthesizer

KEY = "sk-runtime-abcdefghijkl"


async def create(client, payload):
    response = await client.post("/api/connections", json=payload)
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def build(app, connection_id):
    async with app.state.sessionmaker() as session:
        return await build_synthesizer(session, connection_id, secret_box=app.state.secret_box)


async def test_edits_apply_to_the_next_build_without_restart(app, user_client):
    connection_id = await create(
        user_client,
        {"name": "tts", "kind": "openai", "config": {}, "secrets": {"apiKey": KEY}},
    )
    first = await build(app, connection_id)
    assert (first.model, first.voice) == ("gpt-4o-mini-tts", "alloy")
    assert first.client.api_key == KEY
    assert str(first.client.base_url) == "https://api.openai.com/v1/"

    patched = await user_client.patch(
        f"/api/connections/{connection_id}",
        json={
            "config": {"baseUrl": "https://proxy.example.com/v1", "ttsModel": "tts-1"},
            "secrets": {"apiKey": "sk-rotated-abcdefghijkl"},
        },
    )
    assert patched.status_code == 200
    second = await build(app, connection_id)
    assert (second.model, second.voice) == ("tts-1", "alloy")
    assert second.client.api_key == "sk-rotated-abcdefghijkl"
    assert str(second.client.base_url) == "https://proxy.example.com/v1/"
    assert second is not first


async def test_azure_openai_connection_uses_the_deployment(app, user_client):
    connection_id = await create(
        user_client,
        {
            "name": "azure",
            "kind": "azure_openai",
            "config": {
                "endpoint": "https://res.openai.azure.com",
                "apiVersion": "2025-03-01-preview",
                "ttsDeployment": "my-tts",
                "ttsVoice": "verse",
            },
            "secrets": {"apiKey": KEY},
        },
    )
    synth = await build(app, connection_id)
    assert isinstance(synth.client, AsyncAzureOpenAI)
    assert (synth.model, synth.voice) == ("my-tts", "verse")
    assert synth.client.api_key == KEY


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (
            {"kind": "azure_speech", "config": {"region": "eastus"}, "secrets": {"key": KEY}},
            "not implemented yet",
        ),
        (
            {
                "kind": "langfuse",
                "config": {"host": "https://cloud.langfuse.com", "publicKey": "pk-lf-1"},
                "secrets": {"secretKey": KEY},
            },
            "not a TTS provider",
        ),
    ],
)
async def test_non_tts_kinds_are_rejected_clearly(app, user_client, payload, message):
    connection_id = await create(user_client, {"name": payload["kind"], **payload})
    with pytest.raises(UnsupportedConnection, match=message):
        await build(app, connection_id)


async def test_unknown_connection(app):
    with pytest.raises(ConnectionNotFound):
        await build(app, uuid.uuid4())
