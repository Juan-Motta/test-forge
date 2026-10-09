"""No stored secret ever leaves the backend: not in responses, logs or error messages."""

import logging
import uuid

import httpx
import pytest

from voice_eval.modules.connections.api import connection_tester
from voice_eval.modules.connections.domain import UnsupportedConnection
from voice_eval.modules.connections.runtime import build_synthesizer
from voice_eval.modules.connections.testers import ConnectionTester

SECRETS = {
    "openai": "LEAKCANARY-openai-0001",
    "azure_openai": "LEAKCANARY-azure-openai-0002",
    "azure_speech": "LEAKCANARY-azure-speech-0003",
    "langfuse": "LEAKCANARY-langfuse-0004",
}
CONNECTIONS = [
    {"kind": "openai", "config": {}, "secrets": {"apiKey": SECRETS["openai"]}},
    {
        "kind": "azure_openai",
        "config": {
            "endpoint": "https://res.openai.azure.com",
            "apiVersion": "2025-03-01-preview",
            "ttsDeployment": "tts",
        },
        "secrets": {"apiKey": SECRETS["azure_openai"]},
    },
    {
        "kind": "azure_speech",
        "config": {"region": "eastus"},
        "secrets": {"key": SECRETS["azure_speech"]},
    },
    {
        "kind": "langfuse",
        "config": {"host": "https://cloud.langfuse.com", "publicKey": "pk-lf-1"},
        "secrets": {"secretKey": SECRETS["langfuse"]},
    },
]


def echo_everything(request: httpx.Request) -> httpx.Response:
    """A hostile provider: rejects the key and echoes every header back in body and headers."""
    echoed = " ".join(f"{k}={v}" for k, v in request.headers.items())
    return httpx.Response(401, text=f"invalid credentials: {echoed}", headers={"x-echo": echoed})


@pytest.fixture
def hostile_provider(app):
    app.dependency_overrides[connection_tester] = lambda: ConnectionTester(
        transport=httpx.MockTransport(echo_everything)
    )
    yield
    app.dependency_overrides.pop(connection_tester, None)


async def test_secrets_never_leak(app, user_client, hostile_provider, caplog):
    caplog.set_level(logging.DEBUG)
    responses: list[httpx.Response] = []
    errors: list[str] = []

    async def call(method: str, url: str, **kwargs) -> httpx.Response:
        response = await user_client.request(method, url, **kwargs)
        responses.append(response)
        return response

    ids = []
    for payload in CONNECTIONS:
        created = await call("POST", "/api/connections", json={"name": payload["kind"], **payload})
        assert created.status_code == 201
        ids.append(created.json()["id"])
        # the same secrets in failing requests: duplicate name, bad config, wrong types
        assert (
            await call("POST", "/api/connections", json={"name": payload["kind"], **payload})
        ).status_code == 409
        bad_config = {**payload, "name": "bad", "config": {"nope": True}}
        assert (await call("POST", "/api/connections", json=bad_config)).status_code == 422
        secret = next(iter(payload["secrets"].values()))
        wrong_type = {
            **payload,
            "name": "wrong",
            "secrets": {"apiKey": [secret], "key": {"x": secret}},
        }
        assert (await call("POST", "/api/connections", json=wrong_type)).status_code == 422
        not_a_dict = {**payload, "name": "flat", "secrets": secret}
        assert (await call("POST", "/api/connections", json=not_a_dict)).status_code == 422
        assert (await call("POST", "/api/connections/test", json=payload)).status_code == 200
        raw = f'{{"name": "broken", "kind": "openai", "secrets": {{"apiKey": "{secret}"'
        broken = await call(
            "POST", "/api/connections", content=raw, headers={"content-type": "application/json"}
        )
        assert broken.status_code == 422

    await call("GET", "/api/connections")
    for connection_id in ids:
        await call("GET", f"/api/connections/{connection_id}")
        tested = await call("POST", f"/api/connections/{connection_id}/test")
        assert tested.json()["ok"] is False
        await call(
            "PATCH", f"/api/connections/{connection_id}", json={"name": f"n-{connection_id}"}
        )
        kind_change = await call(
            "PATCH",
            f"/api/connections/{connection_id}",
            json={"kind": "openai", "secrets": {"apiKey": SECRETS["openai"]}},
        )
        assert kind_change.status_code == 422
        async with app.state.sessionmaker() as session:
            try:
                await build_synthesizer(
                    session, uuid.UUID(connection_id), secret_box=app.state.secret_box
                )
            except UnsupportedConnection as exc:
                errors.append(str(exc))

    assert len(responses) > 30
    logged = "\n".join(record.getMessage() + (record.exc_text or "") for record in caplog.records)
    for secret in SECRETS.values():
        for response in responses:
            assert secret not in response.text, (response.request.url, response.text)
            assert all(secret not in value for value in response.headers.values())
        assert secret not in logged
        assert all(secret not in error for error in errors)
