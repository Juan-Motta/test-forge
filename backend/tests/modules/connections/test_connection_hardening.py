"""Connections edge cases: stale test results, unsafe secrets, error shapes and integrity errors."""

import uuid
from datetime import UTC, datetime

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy.exc import IntegrityError

from voice_eval.modules.connections import service
from voice_eval.modules.connections.domain import (
    ApiKeySecrets,
    ConnectionConflict,
    ConnectionKind,
    ConnectionNameTaken,
    InvalidConnectionInput,
    UnknownConnectionKind,
    parse_config,
    parse_secrets,
)
from voice_eval.modules.connections.models import ConnectionRecord
from voice_eval.modules.connections.testers import CheckResult, ConnectionTester

SECRET = "sk-proj-abcdefghijklmnop1234"
OPENAI = {
    "name": "OpenAI main",
    "kind": "openai",
    "config": {},
    "secrets": {"apiKey": SECRET},
}


async def create(db, app, name="OpenAI main"):
    async with db() as session:
        return await service.create_connection(
            session,
            app.state.secret_box,
            name=name,
            kind=ConnectionKind.OPENAI,
            config={},
            secrets={"apiKey": SECRET},
            created_by=None,
            allow_local_http=False,
        )


class InterferingTester:
    """Runs `interfere` while the provider call is "in flight", then reports success."""

    def __init__(self, interfere):
        self.interfere = interfere

    async def check(self, kind, config, secrets) -> CheckResult:
        await self.interfere()
        return CheckResult(True, "Connected (HTTP 200)")


# --- Stale-test guard -------------------------------------------------------------------------


async def test_stored_test_is_not_recorded_when_the_row_was_edited_meanwhile(app, db):
    created = await create(db, app)

    async def rename():
        async with db() as other:
            await service.update_connection(
                other, app.state.secret_box, created.id, name="renamed", allow_local_http=False
            )

    async with db() as session:
        result = await service.check_stored(
            session,
            app.state.secret_box,
            InterferingTester(rename),
            created.id,
            allow_local_http=False,
        )
    assert (result.ok, result.detail) == (True, "Connected (HTTP 200)")
    async with db() as session:
        stored = await service.get_connection(session, created.id)
    assert stored.name == "renamed"
    assert stored.last_test is None


async def test_stored_test_is_not_recorded_when_the_row_was_deleted_meanwhile(app, db):
    created = await create(db, app)

    async def delete():
        async with db() as other:
            await service.delete_connection(other, created.id)

    async with db() as session:
        result = await service.check_stored(
            session,
            app.state.secret_box,
            InterferingTester(delete),
            created.id,
            allow_local_http=False,
        )
    assert result.ok is True
    async with db() as session:
        assert await session.get(ConnectionRecord, created.id) is None


# --- Header-unsafe secrets --------------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    ["clé-secrète-1234", "sk-line\r\nX-Injected: 1", "sk-tab\tkey", "sk-null\x00key", "sk key"],
)
def test_secrets_must_be_printable_ascii_without_spaces(value):
    with pytest.raises(InvalidConnectionInput) as info:
        parse_secrets(ConnectionKind.OPENAI, {"apiKey": value})
    (error,) = info.value.errors
    assert error["loc"] == ["secrets", "apiKey"]
    assert value not in str(info.value.errors)


def test_printable_ascii_secrets_are_accepted():
    value = "sk-AZaz09_~!#$%&'()*+,./:;<=>?@[]^`{|}"
    parsed = parse_secrets(ConnectionKind.OPENAI, {"apiKey": value})
    assert parsed.api_key.get_secret_value() == value


async def test_unexpected_tester_errors_become_a_sanitized_failure(caplog):
    def explode(request: httpx.Request) -> httpx.Response:
        raise RuntimeError(f"internal failure while sending {SECRET}")

    tester = ConnectionTester(transport=httpx.MockTransport(explode))
    kind = ConnectionKind.OPENAI
    config = parse_config(kind, {}, allow_local_http=False)
    outcome = await tester.check(kind, config, parse_secrets(kind, {"apiKey": SECRET}))
    assert outcome == CheckResult(False, "Request failed (unexpected error)")
    assert SECRET not in caplog.text


async def test_non_ascii_secret_that_bypassed_validation_fails_cleanly():
    """A stored secret from before the ASCII rule must not crash the tester (UnicodeEncodeError)."""
    tester = ConnectionTester(transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    kind = ConnectionKind.OPENAI
    config = parse_config(kind, {}, allow_local_http=False)
    secrets = ApiKeySecrets.model_construct(api_key=SecretStr("clé-secrète-1234"))
    outcome = await tester.check(kind, config, secrets)
    assert outcome == CheckResult(False, "Request failed (unexpected error)")
    assert "clé" not in outcome.detail


# --- One 422 shape ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": "   "},  # request validation (FastAPI)
        {"config": {"baseUrl": "http://api.example.com"}},  # domain validation
        {"secrets": {}},  # domain validation
    ],
)
async def test_validation_errors_share_one_shape(user_client, overrides):
    response = await user_client.post("/api/connections", json={**OPENAI, **overrides})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail
    for error in detail:
        assert set(error) == {"type", "loc", "msg"}
        assert error["loc"][0] == "body"
        assert isinstance(error["type"], str) and error["type"]


# --- Integrity errors -------------------------------------------------------------------------


async def test_unknown_creator_is_a_conflict_not_a_name_clash(app, db):
    async with db() as session:
        with pytest.raises(ConnectionConflict):
            await service.create_connection(
                session,
                app.state.secret_box,
                name="orphan",
                kind=ConnectionKind.OPENAI,
                config={},
                secrets={"apiKey": SECRET},
                created_by=uuid.uuid4(),  # violates the users foreign key
                allow_local_http=False,
            )


async def test_other_integrity_errors_are_not_reported_as_name_clashes(app, db):
    created = await create(db, app)
    async with db() as session:
        with pytest.raises(IntegrityError):  # the API turns it into a generic 500
            await service.update_connection(
                session, app.state.secret_box, created.id, name="   ", allow_local_http=False
            )


async def test_unique_name_violation_at_commit_is_a_name_clash(app, db):
    await create(db, app, name="taken")
    async with db() as session:
        record = ConnectionRecord(
            id=uuid.uuid4(),
            name="taken",
            kind="openai",
            config={},
            secret_ciphertext="x",
            secret_hint="••••",
        )
        session.add(record)
        with pytest.raises(ConnectionNameTaken):
            await service._commit(session, "taken")


# --- Record to domain -------------------------------------------------------------------------


def _record(**overrides) -> ConnectionRecord:
    now = datetime.now(UTC)
    values = {
        "id": uuid.uuid4(),
        "name": "conn",
        "kind": "openai",
        "config": {"base_url": "https://api.openai.com/v1"},
        "secret_ciphertext": "token",
        "secret_hint": "••••1234",
        "created_at": now,
        "updated_at": now,
        "last_tested_at": None,
        "last_test_ok": None,
        "last_test_detail": None,
    }
    return ConnectionRecord(**{**values, **overrides})


@pytest.mark.parametrize(
    "fields",
    [
        {"last_tested_at": datetime.now(UTC)},  # ok missing
        {"last_test_ok": True},  # time missing
        {"last_test_detail": "Connected"},  # only the detail
    ],
)
def test_partial_last_test_fields_mean_no_last_test(fields):
    assert _record(**fields).to_domain().last_test is None


def test_complete_last_test_without_detail_has_an_empty_detail():
    at = datetime.now(UTC)
    last_test = _record(last_tested_at=at, last_test_ok=False).to_domain().last_test
    assert (last_test.at, last_test.ok, last_test.detail) == (at, False, "")


def test_unknown_stored_kind_is_a_clear_domain_error():
    record = _record(kind="elevenlabs")
    with pytest.raises(UnknownConnectionKind, match="elevenlabs"):
        record.to_domain()


async def test_conflict_is_a_409_that_does_not_blame_the_name(user_client, monkeypatch):
    async def conflicting(*args, **kwargs):
        raise ConnectionConflict("the connection refers to a row that no longer exists")

    monkeypatch.setattr(service, "create_connection", conflicting)
    response = await user_client.post("/api/connections", json=OPENAI)
    assert response.status_code == 409
    assert "name" not in response.json()["detail"].lower()
