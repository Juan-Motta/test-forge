"""Async Alembic environment. The URL comes from the caller or from DATABASE_URL."""

import asyncio
import logging.config

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

import voice_eval.modules.agents.models  # noqa: F401 - registers tables on Base.metadata
import voice_eval.modules.connections.models  # noqa: F401 - registers tables on Base.metadata
import voice_eval.modules.scenarios.models  # noqa: F401 - registers tables on Base.metadata
import voice_eval.modules.users.models  # noqa: F401 - registers tables on Base.metadata
from voice_eval.platform.db import Base
from voice_eval.platform.settings import get_settings

config = context.config
if config.config_file_name is not None and not config.attributes.get("database_url"):
    logging.config.fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _database_url() -> str:
    return config.attributes.get("database_url") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(url=_database_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def _run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(_database_url())
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_run)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
