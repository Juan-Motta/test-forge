import asyncio
import uuid

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, make_url, text
from sqlalchemy.ext.asyncio import create_async_engine

from voice_eval.platform.db import Base
from voice_eval.platform.migrations import downgrade, upgrade

TABLES = {
    "users",
    "user_sessions",
    "login_attempts",
    "provider_connections",
    "agents",
    "scenarios",
    "scenario_groups",
    "run_batches",
    "runs",
    "run_judgements",
    "api_keys",
    "model_prices",
}


async def _tables(url: str) -> set[str]:
    engine = create_async_engine(url)
    async with engine.connect() as conn:
        names = await conn.run_sync(lambda c: set(inspect(c).get_table_names()))
    await engine.dispose()
    return names


async def _schema_diff(url: str) -> list:
    import voice_eval.modules.agents.models  # noqa: F401 - registers the tables on Base
    import voice_eval.modules.api_keys.models  # noqa: F401
    import voice_eval.modules.connections.models  # noqa: F401
    import voice_eval.modules.pricing.models  # noqa: F401
    import voice_eval.modules.runs.models  # noqa: F401
    import voice_eval.modules.scenarios.models  # noqa: F401
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


async def _execute(url: str, *statements: str) -> list:
    """Run statements in one transaction; the rows of the last one."""
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        result = None
        for statement in statements:
            result = await conn.execute(text(statement))
        rows = list(result) if result is not None and result.returns_rows else []
    await engine.dispose()
    return rows


def _agent(agent_id: str, name: str) -> str:
    return (
        "INSERT INTO agents (id, name, context, protocol, base_url, channel_id, user_id)"
        f" VALUES ('{agent_id}', '{name}', '', 'auto', 'wss://agent.example.com/ws', 'c', 'u')"
    )


def _scenario(scenario_id: str, agent_id: str, name: str) -> str:
    return (
        "INSERT INTO scenarios (id, agent_id, name, tags, context, persona, goal, instructions,"
        " facts, criteria, end_conditions)"
        f" VALUES ('{scenario_id}', '{agent_id}', '{name}', '{{}}', '', '{{}}'::jsonb, 'goal', '',"
        " '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)"
    )


def test_scenario_groups_migration_puts_every_scenario_in_its_agents_group(scratch_database_url):
    url = scratch_database_url
    upgrade(url, "0015")
    hotel, support, idle = (str(uuid.uuid4()) for _ in range(3))
    s1, s2, s3 = (str(uuid.uuid4()) for _ in range(3))
    asyncio.run(
        _execute(
            url,
            _agent(hotel, "Hotel desk"),
            _agent(support, "Support triage"),
            _agent(idle, "Idle agent"),
            _scenario(s1, hotel, "Booking"),
            _scenario(s2, hotel, "Cancel"),
            _scenario(s3, support, "Refund"),
        )
    )

    upgrade(url)

    groups = asyncio.run(
        _execute(url, "SELECT name, description, tags FROM scenario_groups ORDER BY name")
    )
    # One group per agent that has scenarios, named after it; the idle agent gets none.
    assert [tuple(row) for row in groups] == [("Hotel desk", "", []), ("Support triage", "", [])]
    placed = asyncio.run(
        _execute(
            url,
            "SELECT scenarios.name, scenario_groups.name FROM scenarios"
            " JOIN scenario_groups ON scenario_groups.id = scenarios.group_id"
            " ORDER BY scenarios.name",
        )
    )
    assert [tuple(row) for row in placed] == [
        ("Booking", "Hotel desk"),
        ("Cancel", "Hotel desk"),
        ("Refund", "Support triage"),
    ]

    # Back to 0015 the scenarios are untouched (only the group column and table go).
    downgrade(url, "0015")
    names = asyncio.run(_execute(url, "SELECT name FROM scenarios ORDER BY name"))
    assert [row[0] for row in names] == ["Booking", "Cancel", "Refund"]
    assert "scenario_groups" not in asyncio.run(_tables(url))
