import asyncio
import io

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine

from voice_eval import cli
from voice_eval.modules.users.models import UserRecord
from voice_eval.modules.users.passwords import verify_password
from voice_eval.platform.settings import Settings

PASSWORD = "a long enough passphrase"


@pytest.fixture
def cli_env(app, settings, monkeypatch):
    """Point the CLI at the test database (app fixture empties the tables first)."""
    monkeypatch.setattr(cli, "load_settings", lambda: settings)


async def _fetch(url: str, email: str):
    engine = create_async_engine(url)
    async with engine.connect() as conn:
        row = (await conn.execute(select(UserRecord).where(UserRecord.email == email))).first()
    await engine.dispose()
    return row


def _run(monkeypatch, argv: list[str], stdin: str) -> int:
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin))
    with pytest.raises(SystemExit) as exit_info:
        cli.main(argv)
    return exit_info.value.code


def test_create_user_with_password_stdin(cli_env, settings, monkeypatch, capsys):
    argv = ["create-user", "--email", "Grace@Example.com", "--display-name", "Grace Hopper"]
    code = _run(monkeypatch, [*argv, "--password-stdin"], PASSWORD + "\n")
    assert code == 0
    output = capsys.readouterr()
    assert PASSWORD not in output.out + output.err
    row = asyncio.run(_fetch(settings.database_url, "grace@example.com"))
    assert row is not None
    assert row.display_name == "Grace Hopper"
    assert row.is_active
    assert row.password_hash.startswith("$argon2id$")
    assert PASSWORD not in row.password_hash
    assert verify_password(PASSWORD, row.password_hash)


def test_create_user_rejects_duplicates_and_short_passwords(cli_env, monkeypatch, capsys):
    argv = ["create-user", "--email", "grace@example.com", "--display-name", "Grace"]
    assert _run(monkeypatch, [*argv, "--password-stdin"], PASSWORD) == 0
    assert _run(monkeypatch, [*argv, "--password-stdin"], PASSWORD) == 1
    assert "already exists" in capsys.readouterr().err
    other = ["create-user", "--email", "linus@example.com", "--display-name", "Linus"]
    assert _run(monkeypatch, [*other, "--password-stdin"], "short") == 1
    assert "at least" in capsys.readouterr().err


def test_create_user_rejects_invalid_email(cli_env, monkeypatch, capsys):
    argv = ["create-user", "--email", "not-an-email", "--display-name", "X", "--password-stdin"]
    assert _run(monkeypatch, argv, PASSWORD) == 1
    assert "email" in capsys.readouterr().err.lower()


def test_interactive_password_must_match(cli_env, monkeypatch, capsys):
    answers = iter([PASSWORD, PASSWORD + "typo"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(answers))
    argv = ["create-user", "--email", "ada@example.com", "--display-name", "Ada"]
    assert _run(monkeypatch, argv, "") == 1
    assert "do not match" in capsys.readouterr().err


def test_migrate_is_idempotent_at_head(cli_env, capsys):
    with pytest.raises(SystemExit) as exit_info:
        cli.main(["migrate"])
    assert exit_info.value.code == 0
    assert "latest migration" in capsys.readouterr().out


def test_missing_settings_name_the_variable_without_values(monkeypatch, capsys):
    def broken() -> Settings:
        return Settings(_env_file=None, database_url="postgresql://user:hunter2@db/x")

    monkeypatch.setattr(cli, "load_settings", broken)
    with pytest.raises(SystemExit) as exit_info:
        cli.main(["migrate"])
    assert exit_info.value.code == 2
    err = capsys.readouterr().err
    assert "DATABASE_URL" in err and "hunter2" not in err
