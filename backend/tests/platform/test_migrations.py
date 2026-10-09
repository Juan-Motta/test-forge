import asyncio
import uuid

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, make_url, text
from sqlalchemy.ext.asyncio import create_async_engine

from voice_eval.platform.db import Base
from voice_eval.platform.migrations import downgrade, upgrade

TABLES = {"users", "user_sessions", "login_attempts", "provider_connections"}


async def _tables(url: str) -> set[str]:
    engine = create_async_engine(url)
    async with engine.connect() as conn:
        names = await conn.run_sync(lambda c: set(inspect(c).get_table_names()))
    await engine.dispose()
    return names


async def _schema_diff(url: str) -> list:
    import voice_eval.modules.connections.models  # noqa: F401 - registers the tables on Base
    import voice_eval.modules.users.models  # noqa: F401

    engine = create_async_engine(url)
    async with engine.connect() as conn:
        diff = await conn.run_sync(
            lambda c: compare_metadata(MigrationContext.configure(c), Base.metadata)
        )
    await engine.dispose()
    return diff


async def _admin(url: str, statement: str) -> None:
    """Run a statement that cannot run inside a transaction (CREATE/DROP DATABASE)."""
    engine = create_async_engine(url, isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        await conn.execute(text(statement))
    await engine.dispose()


@pytest.fixture
def scratch_database_url(postgres_url):
    """An empty database in the same server, dropped afterwards; the shared one stays at head."""
    name = f"migrations_{uuid.uuid4().hex[:12]}"
    asyncio.run(_admin(postgres_url, f'CREATE DATABASE "{name}"'))
    try:
        yield make_url(postgres_url).set(database=name).render_as_string(hide_password=False)
    finally:
        asyncio.run(_admin(postgres_url, f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


def test_upgrade_downgrade_round_trip(postgres_url, scratch_database_url):
    upgrade(scratch_database_url)
    assert asyncio.run(_tables(scratch_database_url)) >= TABLES
    downgrade(scratch_database_url, "base")
    assert not TABLES & asyncio.run(_tables(scratch_database_url))
    assert asyncio.run(_tables(postgres_url)) >= TABLES  # the shared database is untouched
    upgrade(scratch_database_url)
    assert asyncio.run(_tables(scratch_database_url)) >= TABLES


def test_models_match_migrations(postgres_url):
    assert asyncio.run(_schema_diff(postgres_url)) == []
