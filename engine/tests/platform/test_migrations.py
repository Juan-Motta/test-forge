import asyncio

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

from voice_eval.platform.db import Base
from voice_eval.platform.migrations import downgrade, upgrade

TABLES = {"users", "user_sessions", "login_attempts"}


async def _tables(url: str) -> set[str]:
    engine = create_async_engine(url)
    async with engine.connect() as conn:
        names = await conn.run_sync(lambda c: set(inspect(c).get_table_names()))
    await engine.dispose()
    return names


async def _schema_diff(url: str) -> list:
    import voice_eval.modules.users.models  # noqa: F401 - registers the tables on Base

    engine = create_async_engine(url)
    async with engine.connect() as conn:
        diff = await conn.run_sync(
            lambda c: compare_metadata(MigrationContext.configure(c), Base.metadata)
        )
    await engine.dispose()
    return diff


def test_upgrade_downgrade_round_trip(postgres_url):
    assert asyncio.run(_tables(postgres_url)) >= TABLES
    downgrade(postgres_url, "base")
    assert not TABLES & asyncio.run(_tables(postgres_url))
    upgrade(postgres_url)
    assert asyncio.run(_tables(postgres_url)) >= TABLES


def test_models_match_migrations(postgres_url):
    assert asyncio.run(_schema_diff(postgres_url)) == []
