"""Agents use cases: CRUD of the agents under test (voice and text).

The API validates each field's shape; the rules that depend on other fields or the database
(the settings each agent kind needs, the base URL scheme of that kind, the kind of the
referenced Langfuse connection) live here and report all their errors at once. A text agent's
API key is sealed with the `SecretBox` (owner: the agent) and never returned: only a hint.
"""

import uuid
from typing import Any

from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.agents.domain import (
    API_KEY_SECRET_KIND,
    Agent,
    AgentConflict,
    AgentInUse,
    AgentKind,
    AgentNameTaken,
    AgentNotFound,
    AgentProtocol,
    InvalidAgentInput,
    TextAuth,
    TextMode,
    check_base_url,
    check_session_url,
    check_text_channel_id,
)
from voice_eval.modules.agents.models import NAME_UNIQUE_CONSTRAINT, AgentRecord
from voice_eval.modules.connections.domain import (
    HINT_MASK,
    HINT_MIN_SECRET_LENGTH,
    ConnectionKind,
)
from voice_eval.modules.connections.models import ConnectionRecord
from voice_eval.modules.scenarios.service import count_for_agent
from voice_eval.platform.secrets import SecretBox

FOREIGN_KEY_VIOLATION = "23503"
WRITABLE = frozenset(
    {
        "name",
        "context",
        "protocol",
        "base_url",
        "channel_id",
        "user_id",
        "origin",
        "session_url",
        "langfuse_connection_id",
        "text_mode",
        "auth",
    }
)
UNSET: Any = object()  # `api_key` not part of the request (None means: clear it)


def _name_taken(name: str) -> AgentNameTaken:
    return AgentNameTaken(f"an agent named {name!r} already exists")


async def _load(db: AsyncSession, agent_id: uuid.UUID) -> AgentRecord:
    record = await db.get(AgentRecord, agent_id)
    if record is None:
        raise AgentNotFound(str(agent_id))
    return record


def _violation(exc: IntegrityError) -> tuple[str | None, str | None]:
    """(SQLSTATE, constraint name) of the database error behind `exc`, when the driver says."""
    cause = exc.orig.__cause__ if exc.orig is not None else None  # asyncpg's own exception
    return getattr(cause, "sqlstate", None), getattr(cause, "constraint_name", None)


async def _commit(db: AsyncSession, name: str) -> None:
    """Commit; a lost race on the unique name is a name clash, a vanished reference a conflict."""
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        sqlstate, constraint = _violation(exc)
        if constraint == NAME_UNIQUE_CONSTRAINT:
            raise _name_taken(name) from None
        if sqlstate == FOREIGN_KEY_VIOLATION:
            raise AgentConflict("the agent refers to a row that no longer exists") from None
        raise


def _error(loc: str, msg: str) -> dict[str, Any]:
    return {"type": "value_error", "loc": [loc], "msg": msg}


def _kind_errors(
    kind: AgentKind, state: dict[str, Any], changed: dict[str, Any], api_key: Any
) -> list[dict[str, Any]]:
    """Check (and normalize in `changed`) what depends on the agent's kind.

    `state` is the agent as it will be stored (current values with the changes applied);
    `api_key` is the key that will be stored (None: none), or `UNSET` when not sent.
    """
    errors: list[dict[str, Any]] = []
    if "base_url" in changed:
        try:
            changed["base_url"] = check_base_url(changed["base_url"], kind)
        except InvalidAgentInput as exc:
            errors += exc.errors
    if kind == AgentKind.VOICE:
        if state.get("protocol") == AgentProtocol.RELAY:
            if state.get("session_url") is not None and (
                "session_url" in changed or "base_url" in changed
            ):
                try:
                    changed["session_url"] = check_session_url(
                        state["session_url"], changed.get("base_url", state.get("base_url", ""))
                    )
                except InvalidAgentInput as exc:
                    errors += exc.errors
        else:
            # Only the Vivi protocols address a channel and a user.
            if not state.get("channel_id"):
                errors.append(_error("channelId", "required unless the protocol is relay"))
            if state.get("user_id") is None:
                errors.append(_error("userId", "required unless the protocol is relay"))
            if state.get("session_url") is not None:
                errors.append(_error("sessionUrl", "applies only to relay agents"))
        for key, loc in (("text_mode", "textMode"), ("auth", "auth")):
            if state.get(key) is not None:
                errors.append(_error(loc, "applies only to text agents"))
        if api_key not in (UNSET, None):
            errors.append(_error("apiKey", "applies only to text agents"))
        return errors
    if state.get("user_id") is not None:
        errors.append(_error("userId", "applies only to voice agents"))
    if state.get("session_url") is not None:
        errors.append(_error("sessionUrl", "applies only to relay agents"))
    if state.get("protocol") not in (None, AgentProtocol.AUTO):
        errors.append(_error("protocol", "applies only to voice agents"))
    if "channel_id" in changed:
        try:
            changed["channel_id"] = check_text_channel_id(changed["channel_id"])
        except ValueError as exc:
            errors.append(_error("channelId", str(exc)))
    if state.get("text_mode") is None:
        errors.append(_error("textMode", "required for text agents"))
    if state.get("auth") is None:
        errors.append(_error("auth", "required for text agents"))
    elif state["auth"] == TextAuth.API_KEY and api_key is None:
        errors.append(_error("apiKey", "required when auth is api_key"))
    elif state["auth"] == TextAuth.NONE and api_key not in (UNSET, None):
        errors.append(_error("apiKey", "applies only when auth is api_key"))
    return errors


async def _validate(
    db: AsyncSession,
    fields: dict[str, Any],
    *,
    kind: AgentKind,
    state: dict[str, Any],
    api_key: Any,
) -> None:
    """Normalize `fields` in place; raise `InvalidAgentInput` with every error found."""
    errors = _kind_errors(kind, state, fields, api_key)
    connection_id = fields.get("langfuse_connection_id")
    if connection_id is not None:
        connection_kind = await db.scalar(
            select(ConnectionRecord.kind).where(ConnectionRecord.id == connection_id)
        )
        if connection_kind is None:
            msg = "connection not found"
        elif connection_kind != ConnectionKind.LANGFUSE:
            msg = "must reference a langfuse connection"
        else:
            msg = ""
        if msg:
            errors.append({"type": "value_error", "loc": ["langfuseConnectionId"], "msg": msg})
    if errors:
        raise InvalidAgentInput(errors)


def _reveal(api_key: Any) -> Any:
    return api_key.get_secret_value() if isinstance(api_key, SecretStr) else api_key


def _store_api_key(box: SecretBox, record: AgentRecord, api_key: str | None) -> None:
    """Seal `api_key` for `record` (None removes the stored key)."""
    if api_key is None:
        record.auth_ciphertext = record.auth_hint = None
        return
    payload = {"apiKey": api_key}
    record.auth_ciphertext = box.seal(payload, owner=record.id, kind=API_KEY_SECRET_KIND)
    tail = api_key[-4:] if len(api_key) >= HINT_MIN_SECRET_LENGTH else ""
    record.auth_hint = HINT_MASK + tail


def open_api_key(box: SecretBox, record: AgentRecord) -> str | None:
    """The stored API key of `record` in clear, for the request to the agent only."""
    if record.auth_ciphertext is None:
        return None
    data = box.open(record.auth_ciphertext, owner=record.id, kind=API_KEY_SECRET_KIND)
    return data.get("apiKey")


async def agent_api_key(db: AsyncSession, box: SecretBox, agent_id: uuid.UUID) -> str | None:
    """The API key a text agent's requests carry (None: it has none). Never log or return it."""
    return open_api_key(box, await _load(db, agent_id))


async def _ensure_name_free(db: AsyncSession, name: str) -> None:
    if await db.scalar(select(AgentRecord.id).where(AgentRecord.name == name)):
        raise _name_taken(name)


async def list_agents(db: AsyncSession) -> list[Agent]:
    records = await db.scalars(select(AgentRecord).order_by(AgentRecord.name))
    return [record.to_domain() for record in records]


async def get_agent(db: AsyncSession, agent_id: uuid.UUID) -> Agent:
    return (await _load(db, agent_id)).to_domain()


async def create_agent(
    db: AsyncSession,
    box: SecretBox,
    *,
    fields: dict[str, Any],
    created_by: uuid.UUID | None,
) -> Agent:
    """`fields` holds every writable field (snake_case), already shape-validated, plus `kind`
    and `api_key` (a `SecretStr` or None)."""
    kind = AgentKind(fields.get("kind") or AgentKind.VOICE)
    api_key = _reveal(fields.get("api_key"))
    fields = {key: value for key, value in fields.items() if key in WRITABLE}
    if kind == AgentKind.TEXT:
        fields["text_mode"] = fields.get("text_mode") or TextMode.STREAM
        fields["auth"] = fields.get("auth") or TextAuth.NONE
    fields["protocol"] = fields.get("protocol") or AgentProtocol.AUTO
    fields["channel_id"] = fields.get("channel_id") or ""  # a relay agent has none
    await _validate(db, fields, kind=kind, state=fields, api_key=api_key)
    await _ensure_name_free(db, fields["name"])
    record = AgentRecord(id=uuid.uuid4(), created_by=created_by, kind=kind.value, **fields)
    if kind == AgentKind.TEXT and fields["auth"] == TextAuth.API_KEY:
        _store_api_key(box, record, api_key)
    db.add(record)
    await _commit(db, record.name)
    await db.refresh(record)
    return record.to_domain()


async def update_agent(
    db: AsyncSession,
    box: SecretBox,
    agent_id: uuid.UUID,
    *,
    changes: dict[str, Any],
) -> Agent:
    """Apply the given fields only; omitted ones are kept. The kind cannot change; `api_key`
    replaces the stored key, and switching auth to `none` removes it."""
    record = await _load(db, agent_id)
    kind = AgentKind(record.kind)
    if changes.get("kind", kind) != kind:
        raise InvalidAgentInput([_error("kind", "cannot be changed; create a new agent")])
    api_key = _reveal(changes.get("api_key", UNSET))
    changes = {key: value for key, value in changes.items() if key in WRITABLE}
    state = {key: getattr(record, key) for key in WRITABLE} | changes
    if state.get("auth") == TextAuth.API_KEY and api_key is UNSET and record.auth_ciphertext:
        stored: Any = UNSET  # the stored key stays
    else:
        stored = None if api_key is UNSET else api_key
    await _validate(db, changes, kind=kind, state=state, api_key=stored)
    name = changes.get("name")
    if name is not None and name != record.name:
        await _ensure_name_free(db, name)
    for key, value in changes.items():
        setattr(record, key, value)
    if kind == AgentKind.TEXT and stored is not UNSET:
        _store_api_key(box, record, stored if state["auth"] == TextAuth.API_KEY else None)
    record.updated_at = func.now()
    await _commit(db, record.name)
    await db.refresh(record)
    return record.to_domain()


async def delete_agent(db: AsyncSession, agent_id: uuid.UUID) -> None:
    """Refused (`AgentInUse`) while scenarios reference the agent, even one added meanwhile."""
    record = await _load(db, agent_id)
    if scenarios := await count_for_agent(db, agent_id):
        raise AgentInUse(scenarios)
    await db.delete(record)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if _violation(exc)[0] != FOREIGN_KEY_VIOLATION:
            raise
        raise AgentInUse(await count_for_agent(db, agent_id)) from None
