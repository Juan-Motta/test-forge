"""Agents domain: the agents under test, how to reach them, and the module's errors.

An agent is a `voice` agent (a WebSocket voice session) or a `text` agent (a chat over HTTP).
It stores only what is stable across runs; every run gets a fresh `threadId` (see
`target_spec`). Validation errors carry the field location and a message, never the value. A
text agent's API key is stored sealed; the domain only knows whether there is one and its hint.
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
# Hosts on this machine (or, from the backend container, the host it runs on): plain ws:// is
# accepted for them in every environment, for agents under test running locally.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "host.docker.internal"})


class AgentKind(StrEnum):
    VOICE = "voice"
    TEXT = "text"


class TextMode(StrEnum):
    INVOKE = "invoke"  # one request, the whole reply at once
    STREAM = "stream"  # the reply as a stream of `data:` lines


class TextAuth(StrEnum):
    NONE = "none"
    API_KEY = "api_key"  # the `vivi-api-key` header


API_KEY_SECRET_KIND = "agent_api_key"  # the SecretBox kind of a sealed agent API key


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
    user_id: str | None  # voice agents only
    origin: str | None
    langfuse_connection_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    kind: AgentKind = AgentKind.VOICE
    text_mode: TextMode | None = None  # text agents only
    auth: TextAuth | None = None  # text agents only
    has_api_key: bool = False
    api_key_hint: str | None = None


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


def check_base_url(value: str, kind: AgentKind = AgentKind.VOICE) -> str:
    """The agent's base URL. Voice: `wss://`, or `ws://` to a local host (`LOCAL_HOSTS`).
    Text: `https://`, or `http://` to a local host.

    Raises `InvalidAgentInput` located at `baseUrl`.
    """
    secure, plain = ("https", "http") if kind == AgentKind.TEXT else ("wss", "ws")
    value = value.strip()
    try:
        if len(value) > MAX_URL_LENGTH:
            raise ValueError("URL is too long")
        parts, host = _split(value)
        local_plain = parts.scheme == plain and host.lower() in LOCAL_HOSTS
        if parts.scheme != secure and not local_plain:
            raise ValueError(
                f"URL must use {secure} ({plain}:// is accepted only for localhost, 127.0.0.1 "
                "and host.docker.internal)"
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


def check_text_channel_id(value: str) -> str:
    """A text agent's channel id: a UUID, normalized to lower case. Raises ValueError."""
    try:
        return str(uuid.UUID(value.strip()))
    except ValueError:
        raise ValueError("must be a UUID for text agents") from None


def check_user_id(value: str) -> str:
    if not value.isprintable():
        raise ValueError("must contain only printable characters")
    return value


def target_spec(agent: Agent, *, thread_id: str | None = None) -> TargetSpec:
    """The probe target for one run of voice `agent`: a fresh threadId unless one is given."""
    if agent.kind != AgentKind.VOICE or agent.user_id is None:
        raise ValueError("only voice agents have a voice target")
    fields: dict[str, Any] = {} if thread_id is None else {"thread_id": thread_id}
    return TargetSpec(
        base_url=agent.base_url,
        channel_id=agent.channel_id,
        user_id=agent.user_id,
        origin=agent.origin,
        protocol=agent.protocol.value,
        **fields,
    )
