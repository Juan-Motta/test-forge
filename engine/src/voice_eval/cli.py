"""`voice-eval`: backend administration (database migrations, user accounts)."""

import argparse
import asyncio
import getpass
import sys

from pydantic import ValidationError

from voice_eval.modules.users import service
from voice_eval.modules.users.domain import InvalidUserInput, User, UserAlreadyExists
from voice_eval.platform.db import create_engine, create_sessionmaker
from voice_eval.platform.migrations import upgrade
from voice_eval.platform.settings import Settings, get_settings


def load_settings() -> Settings:
    return get_settings()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="voice-eval", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate", help="apply database migrations (alembic upgrade head)")
    create = commands.add_parser("create-user", help="create a user who can log in")
    create.add_argument("--email", required=True)
    create.add_argument("--display-name", required=True)
    create.add_argument(
        "--password-stdin",
        action="store_true",
        help="read the password from the first line of stdin instead of prompting",
    )
    return parser


def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\r\n")
    password = getpass.getpass("Password: ")
    if getpass.getpass("Repeat password: ") != password:
        raise InvalidUserInput("passwords do not match")
    return password


async def _create_user(settings: Settings, email: str, display_name: str, password: str) -> User:
    engine = create_engine(settings.database_url)
    try:
        async with create_sessionmaker(engine)() as db:
            return await service.create_user(db, email, display_name, password)
    finally:
        await engine.dispose()


def _fail(message: str, code: int = 1) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(code)


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
        settings = load_settings()
    except ValidationError as exc:
        fields = ", ".join(".".join(map(str, e["loc"])).upper() for e in exc.errors())
        _fail(f"invalid or missing settings: {fields} (see .env.example)", code=2)
    try:
        if args.command == "migrate":
            upgrade(settings.database_url)
            print("database is at the latest migration")
        else:
            password = _read_password(args.password_stdin)
            user = asyncio.run(_create_user(settings, args.email, args.display_name, password))
            print(f"created user {user.email} ({user.id})")
    except (InvalidUserInput, UserAlreadyExists) as exc:
        _fail(str(exc))
    except KeyboardInterrupt:
        sys.exit(130)
    sys.exit(0)


if __name__ == "__main__":
    main()
