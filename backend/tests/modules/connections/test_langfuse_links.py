"""Langfuse links: the project of a Langfuse connection, looked up once and cached, and the
session / trace URLs built from it."""

import uuid
from datetime import timedelta

from sqlalchemy import update

from voice_eval.modules.connections.langfuse_links import (
    LangfuseLinks,
    session_url,
    trace_url,
)
from voice_eval.modules.connections.models import ConnectionRecord
from voice_eval.providers.langfuse_projects import ProjectLookupError

SECRET = "sk-lf-links-abcdefghijkl"


class FakeLookup:
    def __init__(self, *results: str | Exception) -> None:
        self.results = list(results)
        self.calls: list[tuple[str, str, str, bool]] = []

    async def __call__(self, host, public_key, secret_key, *, allow_private=False) -> str:
        self.calls.append((host, public_key, secret_key, allow_private))
        result = self.results.pop(0) if len(self.results) > 1 else self.results[0]
        if isinstance(result, Exception):
            raise result
        return result


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


async def create_langfuse(client, host="https://cloud.langfuse.com") -> uuid.UUID:
    response = await client.post(
        "/api/connections",
        json={
            "name": f"lf-{uuid.uuid4().hex[:6]}",
            "kind": "langfuse",
            "config": {"host": host, "publicKey": "pk-lf-1"},
            "secrets": {"secretKey": SECRET},
        },
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def resolve(app, links: LangfuseLinks, connection_id: uuid.UUID):
    async with app.state.sessionmaker() as db:
        return await links.resolve(db, connection_id, secret_box=app.state.secret_box)


def test_session_url_encodes_the_session_id():
    assert (
        session_url("https://lf.example/", "proj-1", "thread a/b?c")
        == "https://lf.example/project/proj-1/sessions/thread%20a%2Fb%3Fc"
    )


def test_trace_url_encodes_the_trace_id():
    assert trace_url("https://lf.example/", "t/1") == "https://lf.example/trace/t%2F1"


async def test_the_project_is_looked_up_once_per_connection(app, user_client):
    connection_id = await create_langfuse(user_client)
    lookup = FakeLookup("proj-1")
    links = LangfuseLinks(lookup=lookup)

    first = await resolve(app, links, connection_id)
    second = await resolve(app, links, connection_id)

    assert first == second
    assert (first.host, first.project_id) == ("https://cloud.langfuse.com", "proj-1")
    assert lookup.calls == [("https://cloud.langfuse.com", "pk-lf-1", SECRET, False)]


async def test_an_edited_connection_is_looked_up_again(app, user_client):
    connection_id = await create_langfuse(user_client)
    lookup = FakeLookup("proj-1", "proj-2")
    links = LangfuseLinks(lookup=lookup)
    assert (await resolve(app, links, connection_id)).project_id == "proj-1"

    async with app.state.sessionmaker() as db:
        await db.execute(
            update(ConnectionRecord)
            .where(ConnectionRecord.id == connection_id)
            .values(updated_at=ConnectionRecord.updated_at + timedelta(days=1))
        )
        await db.commit()

    assert (await resolve(app, links, connection_id)).project_id == "proj-2"
    assert len(lookup.calls) == 2


async def test_an_unreachable_langfuse_gives_no_project_and_is_retried_later(app, user_client):
    connection_id = await create_langfuse(user_client)
    lookup = FakeLookup(ProjectLookupError("Could not connect to Langfuse"), "proj-1")
    clock = Clock()
    links = LangfuseLinks(lookup=lookup, clock=clock, failure_ttl_s=60)

    down = await resolve(app, links, connection_id)
    assert (down.host, down.project_id) == ("https://cloud.langfuse.com", None)
    assert (await resolve(app, links, connection_id)).project_id is None
    assert len(lookup.calls) == 1  # the failure is remembered for a while

    clock.now += 61
    assert (await resolve(app, links, connection_id)).project_id == "proj-1"
    assert len(lookup.calls) == 2


async def test_an_unexpected_lookup_error_gives_no_project(app, user_client):
    connection_id = await create_langfuse(user_client)
    links = LangfuseLinks(lookup=FakeLookup(RuntimeError(SECRET)))
    assert (await resolve(app, links, connection_id)).project_id is None


async def test_unknown_or_other_connections_resolve_to_nothing(app, user_client):
    other = await user_client.post(
        "/api/connections",
        json={
            "name": "chat",
            "kind": "openai",
            "config": {},
            "secrets": {"apiKey": "sk-abcdefghijkl"},
        },
    )
    lookup = FakeLookup("proj-1")
    links = LangfuseLinks(lookup=lookup)
    assert await resolve(app, links, uuid.UUID(other.json()["id"])) is None
    assert await resolve(app, links, uuid.uuid4()) is None
    assert lookup.calls == []


async def test_the_cache_holds_no_secret(app, user_client):
    connection_id = await create_langfuse(user_client)
    links = LangfuseLinks(lookup=FakeLookup("proj-1"))
    resolved = await resolve(app, links, connection_id)
    assert SECRET not in repr(resolved)
    assert SECRET not in repr(links.__dict__)
