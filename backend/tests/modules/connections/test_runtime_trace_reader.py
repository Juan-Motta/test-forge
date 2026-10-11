"""Runtime resolver: a Langfuse connection builds a trace reader; other kinds are refused."""

import base64
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from voice_eval.modules.connections.domain import ConnectionNotFound, UnsupportedConnection
from voice_eval.modules.connections.runtime import build_trace_reader
from voice_eval.providers.langfuse_traces import LangfuseTraceReader

SECRET = "sk-lf-runtime-abcdefghijkl"


async def create(client, payload):
    response = await client.post("/api/connections", json=payload)
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def build(app, connection_id):
    async with app.state.sessionmaker() as session:
        return await build_trace_reader(session, connection_id, secret_box=app.state.secret_box)


async def test_langfuse_connection_builds_an_authenticated_reader(app, user_client):
    connection_id = await create(
        user_client,
        {
            "name": "lf",
            "kind": "langfuse",
            "config": {"host": "https://cloud.langfuse.com", "publicKey": "pk-lf-1"},
            "secrets": {"secretKey": SECRET},
        },
    )
    reader = await build(app, connection_id)
    assert isinstance(reader, LangfuseTraceReader)
    assert (reader.host, reader.public_key) == ("https://cloud.langfuse.com", "pk-lf-1")
    assert reader.allow_private is False

    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers["Authorization"])
        return httpx.Response(200, json={"data": []})

    reader.transport = httpx.MockTransport(handler)
    start = datetime(2026, 10, 1, tzinfo=UTC)
    await reader.fetch_session("thread", start=start, end=start + timedelta(minutes=1))
    assert seen == [f"Basic {base64.b64encode(f'pk-lf-1:{SECRET}'.encode()).decode()}"]


async def test_other_kinds_cannot_read_traces(app, user_client):
    connection_id = await create(
        user_client,
        {"name": "chat", "kind": "openai", "config": {}, "secrets": {"apiKey": "sk-abcdefghijkl"}},
    )
    with pytest.raises(UnsupportedConnection, match="cannot read traces"):
        await build(app, connection_id)
    with pytest.raises(ConnectionNotFound):
        await build(app, uuid.uuid4())
