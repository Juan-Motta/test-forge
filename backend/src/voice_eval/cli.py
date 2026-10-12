"""`voice-eval`: backend administration (database migrations, user accounts) and judge checks.

Failures print one `error: ...` line (never a traceback, a URL or a password) and exit with
`EXIT_INVALID_INPUT`, `EXIT_CONFIG`, `EXIT_DATABASE` or `EXIT_JUDGE`.
"""

import argparse
import asyncio
import getpass
import json
import re
import sys
import uuid
from typing import Any, NoReturn

import asyncpg
from pydantic import ValidationError
from sqlalchemy import String, cast, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from voice_eval.judge.domain import JudgeError, JudgeResult
from voice_eval.judge.stability import render_stability, summarize_stability
from voice_eval.modules.judgements.coordinator import JudgementCoordinator, judge_inputs
from voice_eval.modules.judgements.domain import JudgementFailed
from voice_eval.modules.runs.domain import RunNotFound, RunStatus
from voice_eval.modules.runs.manager import is_judgeable
from voice_eval.modules.runs.models import RunRecord
from voice_eval.modules.users import service
from voice_eval.modules.users.domain import InvalidUserInput, User, UserAlreadyExists
from voice_eval.platform.db import create_engine, create_sessionmaker
from voice_eval.platform.migrations import upgrade
from voice_eval.platform.secrets import MasterKeyError, SecretBox
from voice_eval.platform.settings import Settings, get_settings

EXIT_INVALID_INPUT = 1
EXIT_CONFIG = 2
EXIT_DATABASE = 3
EXIT_JUDGE = 4
STABILITY_TIMES = (2, 10)  # judge-stability --times bounds; each time is one paid model call
MIN_PREFIX = 4
RUN_PREFIX = re.compile(r"[0-9a-f-]+")
ACTIVE_STATUSES = {RunStatus.QUEUED, RunStatus.CONNECTING, RunStatus.RUNNING}
# asyncpg errors raised while connecting are not always wrapped by SQLAlchemy.
DATABASE_ERRORS = (SQLAlchemyError, OSError, asyncpg.PostgresError, asyncpg.InterfaceError)


class InvalidRun(Exception):
    """The run reference matches no run, several runs, or a run that cannot be judged."""


def load_settings() -> Settings:
    return get_settings()


def build_coordinator(
    settings: Settings, sessionmaker: async_sessionmaker[AsyncSession]
) -> JudgementCoordinator:
    """A coordinator like the app's; only its read-only `prepare` and `evaluator` are used."""
    development = settings.environment == "development"
    return JudgementCoordinator(
        sessionmaker,
        secret_box=SecretBox.from_settings(settings),
        allow_local_http=development,
        allow_private=development,
    )


def _times(value: str) -> int:
    low, high = STABILITY_TIMES
    try:
        times = int(value)
    except ValueError:
        times = 0
    if not low <= times <= high:
        raise argparse.ArgumentTypeError(f"must be a whole number from {low} to {high}")
    return times


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
    stability = commands.add_parser(
        "judge-stability",
        help="judge a finished run several times on the same evidence and report how much the "
        "bands move (one paid model call per time; stores nothing)",
    )
    stability.add_argument("run", help="the run id, or a unique prefix of it (at least 4 chars)")
    stability.add_argument(
        "--times", type=_times, default=3, help="judgements to compare, 2-10 (default 3)"
    )
    stability.add_argument("--json", action="store_true", help="print the report as JSON")
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


async def _resolve_run(db: AsyncSession, reference: str) -> tuple[uuid.UUID, RunStatus, Any]:
    """The id, status and stored summary of the run whose id starts with `reference` (a full
    id included), ignoring case."""
    reference = reference.strip().lower()
    if len(reference) < MIN_PREFIX or not RUN_PREFIX.fullmatch(reference):
        raise InvalidRun(
            f"expected a run id or a prefix of at least {MIN_PREFIX} hex characters, "
            f"got {reference!r}"
        )
    query = (
        select(RunRecord.id, RunRecord.status, RunRecord.summary)
        .where(cast(RunRecord.id, String).startswith(reference))
        .limit(2)
    )
    matches = (await db.execute(query)).all()
    if not matches:
        raise InvalidRun(f"no run matches {reference!r}")
    if len(matches) > 1:
        raise InvalidRun(f"more than one run starts with {reference!r}; give more characters")
    run_id, status, summary = matches[0]
    return run_id, RunStatus(status), summary


def _progress(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


async def _judge_stability(
    settings: Settings, reference: str, times: int
) -> tuple[dict[str, Any], str]:
    """Judge the run `times` times on inputs prepared once (one Langfuse fetch), storing
    nothing; the report as JSON-ready data and as a table."""
    engine = create_engine(settings.database_url)
    try:
        sessionmaker = create_sessionmaker(engine)
        coordinator = build_coordinator(settings, sessionmaker)
        async with sessionmaker() as db:
            run_id, status, summary = await _resolve_run(db, reference)
        if status in ACTIVE_STATUSES:
            raise InvalidRun(f"run {run_id} has not finished yet ({status})")
        if not is_judgeable(status, summary):
            raise InvalidRun(f"run {run_id} is {status} and cannot be judged")

        _progress(f"run {run_id}: {times} model calls (one per judgement); nothing is stored")
        inputs = await coordinator.prepare(run_id)
        _progress(f"traces: {inputs.trace_note or 'read'}")
        model = await coordinator.evaluator(inputs.run)
        results: list[JudgeResult] = []
        for index in range(1, times + 1):
            results.append(await judge_inputs(model, inputs))
            _progress(f"judgement {index}/{times}: overall {results[-1].overall_score}")
    finally:
        await engine.dispose()
    report = summarize_stability(results)
    data = {"runId": str(run_id), "model": inputs.model_name, **report.to_dict()}
    return data, render_stability(report)


def _fail(message: str, code: int = EXIT_INVALID_INPUT) -> NoReturn:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(code)


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
        settings = load_settings()
    except ValidationError as exc:
        fields = ", ".join(".".join(map(str, e["loc"])).upper() for e in exc.errors())
        _fail(f"invalid or missing settings: {fields} (see .env.example)", code=EXIT_CONFIG)
    try:
        if args.command == "migrate":
            upgrade(settings.database_url)
            print("database is at the latest migration")
        elif args.command == "judge-stability":
            data, table = asyncio.run(_judge_stability(settings, args.run, args.times))
            print(json.dumps(data, indent=2) if args.json else table)
        else:
            password = _read_password(args.password_stdin)
            user = asyncio.run(_create_user(settings, args.email, args.display_name, password))
            print(f"created user {user.email} ({user.id})")
    except (InvalidUserInput, UserAlreadyExists, InvalidRun, RunNotFound) as exc:
        _fail(str(exc))
    except MasterKeyError as exc:
        _fail(str(exc), code=EXIT_CONFIG)
    except (JudgementFailed, JudgeError) as exc:  # messages are safe to show
        _fail(f"judging failed: {exc}", code=EXIT_JUDGE)
    except FileNotFoundError as exc:  # alembic.ini outside the source tree; no secret in it
        _fail(str(exc), code=EXIT_CONFIG)
    except DATABASE_ERRORS as exc:  # the message may quote the URL: name the type only
        _fail(
            f"database operation failed ({type(exc).__name__}); "
            "check DATABASE_URL and that the database is reachable",
            code=EXIT_DATABASE,
        )
    except KeyboardInterrupt:
        sys.exit(130)
    sys.exit(0)


if __name__ == "__main__":
    main()
