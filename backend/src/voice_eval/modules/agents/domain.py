"""Agents domain: the voice agents under test, how to reach them, and the module's errors.

An agent stores only what is stable across runs; every run gets a fresh `threadId`
(see `target_spec`). Validation errors carry the field location and a message, never the value.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any
from urllib.parse import urlsplit

from voice_eval.targets.detect import TargetSpec

# Column sizes shared by the models, the API schemas and the use cases (migrations keep literals).
MAX_NAME_LENGTH = 120
MAX_CONTEXT_LENGTH = 20000
MAX_URL_LENGTH = 2048
MAX_CHANNEL_ID_LENGTH = 200
MAX_USER_ID_LENGTH = 200
MAX_ORIGIN_LENGTH = 300
CHANNEL_ID_PATTERN = r"^[A-Za-z0-9._~-]+$"  # URL-path-safe (RFC 3986 unreserved characters)
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1"})


class AgentProtocol(StrEnum):
    AUTO = "auto"
    LIVE = "live"
    REALTIME = "realtime"


@dataclass(frozen=True)
class Agent:
    id: uuid.UUID
    name: str
    context: str
    protocol: AgentProtocol
    base_url: str
    channel_id: str
    user_id: str
    origin: str | None
    langfuse_connection_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class AgentNotFound(Exception):
    pass


class AgentNameTaken(Exception):
    pass


class AgentConflict(Exception):
    """The write conflicts with a concurrent change (e.g. a referenced row was deleted)."""


class AgentInUse(Exception):
    """Scenarios still reference the agent."""

    def __init__(self, scenarios: int) -> None:
        super().__init__(f"agent is used by {scenarios} scenario(s)")
        self.scenarios = scenarios


class InvalidAgentInput(ValueError):
    """`errors` is a list of `{"type", "loc", "msg"}` items; never the submitted value."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        super().__init__("invalid agent input")
        self.errors = errors


def _split(value: str) -> tuple[Any, str]:
    """Parsed URL and host; ValueError (without the value) when it is not a usable URL."""
    if any(char.isspace() or char == "\\" or not char.isprintable() for char in value):
        raise ValueError("URL must not contain spaces, backslashes or control characters")
    parts = urlsplit(value)
    try:
        host = parts.hostname
        parts.port  # noqa: B018 - raises ValueError on a malformed port
    except ValueError:
        raise ValueError("URL is not valid") from None
    if not host:
        raise ValueError("URL must be absolute and name a host")
    if "@" in parts.netloc:
        raise ValueError("URL must not contain credentials")
    if parts.query or parts.fragment or value.endswith(("?", "#")):
        raise ValueError("URL must not contain a query string or fragment")
    return parts, host


def check_base_url(value: str, *, allow_local_ws: bool) -> str:
    """The agent's WebSocket base URL: `wss://` (local `ws://` only in development).

    Raises `InvalidAgentInput` located at `baseUrl`.
    """
    value = value.strip()
    try:
        if len(value) > MAX_URL_LENGTH:
            raise ValueError("URL is too long")
        parts, host = _split(value)
        local_ws = parts.scheme == "ws" and host in LOCAL_HOSTS and allow_local_ws
        if parts.scheme != "wss" and not local_ws:
            raise ValueError(
                "URL must use wss (ws://localhost is accepted only when ENVIRONMENT=development)"
            )
    except ValueError as exc:
        raise InvalidAgentInput(
            [{"type": "value_error", "loc": ["baseUrl"], "msg": str(exc)}]
        ) from None
    return value.rstrip("/")


def check_origin(value: str) -> str:
    """An HTTP(S) origin: scheme, host and optional port only. Raises ValueError."""
    value = value.strip()
    parts, _ = _split(value)
    if parts.scheme not in ("https", "http"):
        raise ValueError("Origin must use https or http")
    if parts.path not in ("", "/"):
        raise ValueError("Origin must be only scheme, host and port, without a path")
    return value.rstrip("/")


def check_user_id(value: str) -> str:
    if not value.isprintable():
        raise ValueError("must contain only printable characters")
    return value


def target_spec(agent: Agent, *, thread_id: str | None = None) -> TargetSpec:
    """The probe target for one run of `agent`: a fresh threadId unless one is given."""
    fields: dict[str, Any] = {} if thread_id is None else {"thread_id": thread_id}
    return TargetSpec(
        base_url=agent.base_url,
        channel_id=agent.channel_id,
        user_id=agent.user_id,
        origin=agent.origin,
        protocol=agent.protocol.value,
        **fields,
    )
