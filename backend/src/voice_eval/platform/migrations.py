"""Run Alembic migrations programmatically (`voice-eval migrate`, tests)."""

from pathlib import Path

from alembic import command
from alembic.config import Config

ALEMBIC_INI = Path(__file__).resolve().parents[3] / "alembic.ini"


def alembic_config(database_url: str) -> Config:
    if not ALEMBIC_INI.is_file():
        raise FileNotFoundError(f"alembic.ini not found at {ALEMBIC_INI}; run from the source tree")
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(ALEMBIC_INI.parent / "migrations"))
    # Passed as an attribute, not a main option: configparser would choke on `%` in passwords.
    config.attributes["database_url"] = database_url
    return config


def upgrade(database_url: str, revision: str = "head") -> None:
    command.upgrade(alembic_config(database_url), revision)


def downgrade(database_url: str, revision: str) -> None:
    command.downgrade(alembic_config(database_url), revision)
