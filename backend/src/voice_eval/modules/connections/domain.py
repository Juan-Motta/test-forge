"""Connections domain: provider kinds, their config and secrets, and the module's errors.

Config is plain data, returned by the API. Secrets are write-only: they are validated here,
sealed by the platform secret box, and only ever revealed to build a provider client.
Validation errors carry the field location and a message, never the submitted value.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    StringConstraints,
    ValidationError,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

MAX_NAME_LENGTH = 120
MAX_TEST_DETAIL_LENGTH = 500
HINT_MASK = "••••"
HINT_MIN_SECRET_LENGTH = 12
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1"})
CHAT_MODEL = "gpt-6-luna"  # the evaluator's only model (Azure: a deployment of it)
LEGACY_CONFIG_KEYS = frozenset({"chat_model", "chatModel"})  # once configurable, now ignored


class RealtimeModel(StrEnum):
    """The realtime evaluator's models a scenario chooses from (Azure: a deployment of each)."""

    MINI = "gpt-realtime-2.1-mini"
    FULL = "gpt-realtime-2.1"


REALTIME_MODELS = tuple(model.value for model in RealtimeModel)
DEFAULT_REALTIME_MODEL = RealtimeModel.MINI


class ConnectionKind(StrEnum):
    OPENAI = "openai"
    AZURE_OPENAI = "azure_openai"
    AZURE_SPEECH = "azure_speech"
    LANGFUSE = "langfuse"


@dataclass(frozen=True)
class LastTest:
    at: datetime
    ok: bool
    detail: str


@dataclass(frozen=True)
class Connection:
    """A stored connection as the rest of the app may see it: no secret, only a hint."""

    id: uuid.UUID
    name: str
    kind: ConnectionKind
    config: dict[str, Any]
    secret_hint: str
    has_secret: bool
    last_test: LastTest | None
    created_at: datetime
    updated_at: datetime


class ConnectionNotFound(Exception):
    pass


class ConnectionNameTaken(Exception):
    pass


class ConnectionConflict(Exception):
    """The write conflicts with a concurrent change (e.g. the creating user was deleted)."""


class UnknownConnectionKind(ValueError):
    """A stored row has a kind this version does not know (e.g. written by a newer version)."""


class UnsupportedConnection(ValueError):
    """The connection exists but cannot serve the requested role (e.g. TTS)."""


class InvalidConnectionInput(ValueError):
    """`errors` is a list of `{"type", "loc", "msg"}` items; never the submitted value."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        super().__init__("invalid connection input")
        self.errors = errors


# --- Field types ---------------------------------------------------------------------------

Identifier = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._:-]+$"
    ),
]


def check_header_safe(value: SecretStr) -> SecretStr:
    """Secrets travel in HTTP headers: visible ASCII only (no spaces, line breaks or Unicode)."""
    if not all("!" <= char <= "~" for char in value.get_secret_value()):
        raise ValueError(
            "must contain only printable ASCII characters, without spaces or line breaks"
        )
    return value


Secret = Annotated[
    SecretStr, Field(min_length=1, max_length=4096), AfterValidator(check_header_safe)
]


def check_url(value: str, info: ValidationInfo) -> str:
    """https only (local http in development), no credentials, query or fragment."""
    allow_local_http = bool((info.context or {}).get("allow_local_http"))
    value = value.strip()
    if len(value) > 2048:
        raise ValueError("URL is too long")
    if any(char.isspace() or char == "\\" or not char.isprintable() for char in value):
        raise ValueError("URL must not contain spaces, backslashes or control characters")
    parts = urlsplit(value)
    try:
        host = parts.hostname
        parts.port  # noqa: B018 - raises ValueError on a malformed port
    except ValueError:
        raise ValueError("URL is not valid") from None
    if not host:
        raise ValueError("URL must be absolute, like https://host/path")
    if "@" in parts.netloc:
        raise ValueError("URL must not contain credentials")
    if parts.query or parts.fragment or value.endswith(("?", "#")):
        raise ValueError("URL must not contain a query string or fragment")
    local_http = parts.scheme == "http" and host in LOCAL_HOSTS and allow_local_http
    if parts.scheme != "https" and not local_http:
        raise ValueError(
            "URL must use https (http://localhost is accepted only when ENVIRONMENT=development)"
        )
    return value.rstrip("/")


class _Model(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
        hide_input_in_errors=True,
    )


# --- Config per kind -----------------------------------------------------------------------


class OpenAIConfig(_Model):
    base_url: str = "https://api.openai.com/v1"
    tts_model: Identifier = "gpt-4o-mini-tts"
    tts_voice: Identifier = "alloy"

    check_base_url = field_validator("base_url")(check_url)

    @model_validator(mode="before")
    @classmethod
    def drop_legacy_keys(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {key: value for key, value in data.items() if key not in LEGACY_CONFIG_KEYS}
        return data

    @property
    def chat_model(self) -> str:
        """The evaluator's model: fixed, not configurable."""
        return CHAT_MODEL


class AzureOpenAIConfig(_Model):
    endpoint: str
    api_version: Identifier
    tts_deployment: Identifier
    tts_voice: Identifier = "alloy"
    # A gpt-6-luna deployment; without it the connection cannot evaluate.
    chat_deployment: Identifier | None = None
    # A gpt-realtime-2.1-mini deployment, for scenarios with the realtime evaluator.
    realtime_deployment: Identifier | None = None
    # A gpt-realtime-2.1 deployment, for realtime scenarios that choose the full model.
    realtime_full_deployment: Identifier | None = None

    check_endpoint = field_validator("endpoint")(check_url)

    def realtime_deployment_for(self, model: str) -> str | None:
        """The deployment of the realtime `model`, or None when the connection has none."""
        if model == RealtimeModel.FULL:
            return self.realtime_full_deployment
        return self.realtime_deployment


class AzureSpeechConfig(_Model):
    region: Annotated[str, StringConstraints(pattern=r"^[a-z0-9]{1,40}$")] | None = None
    endpoint: str | None = None
    voice: Identifier | None = None

    @field_validator("endpoint")
    @classmethod
    def check_endpoint(cls, value: str | None, info: ValidationInfo) -> str | None:
        return None if value is None else check_url(value, info)

    @model_validator(mode="after")
    def check_region_or_endpoint(self) -> "AzureSpeechConfig":
        if (self.region is None) == (self.endpoint is None):
            raise ValueError("set exactly one of region or endpoint")
        return self


class LangfuseConfig(_Model):
    host: str
    public_key: Identifier

    check_host = field_validator("host")(check_url)


# --- Secrets per kind ----------------------------------------------------------------------


class ApiKeySecrets(_Model):
    api_key: Secret


class AzureSpeechSecrets(_Model):
    key: Secret


class LangfuseSecrets(_Model):
    secret_key: Secret


CONFIG_MODELS: dict[ConnectionKind, type[_Model]] = {
    ConnectionKind.OPENAI: OpenAIConfig,
    ConnectionKind.AZURE_OPENAI: AzureOpenAIConfig,
    ConnectionKind.AZURE_SPEECH: AzureSpeechConfig,
    ConnectionKind.LANGFUSE: LangfuseConfig,
}
SECRET_MODELS: dict[ConnectionKind, type[_Model]] = {
    ConnectionKind.OPENAI: ApiKeySecrets,
    ConnectionKind.AZURE_OPENAI: ApiKeySecrets,
    ConnectionKind.AZURE_SPEECH: AzureSpeechSecrets,
    ConnectionKind.LANGFUSE: LangfuseSecrets,
}


def _sanitized(exc: ValidationError, prefix: str) -> list[dict[str, Any]]:
    return [
        {
            "type": error["type"],
            "loc": [prefix, *(str(part) for part in error["loc"])],
            "msg": error["msg"],
        }
        for error in exc.errors(include_url=False, include_input=False, include_context=False)
    ]


def _validate(model: type[_Model], data: Any, prefix: str, context: dict[str, Any]) -> Any:
    try:
        return model.model_validate(data, context=context)
    except ValidationError as exc:
        raise InvalidConnectionInput(_sanitized(exc, prefix)) from None


def parse_config(kind: ConnectionKind, data: Any, *, allow_local_http: bool) -> Any:
    """Validate a config payload (camelCase or snake_case keys) into the kind's model."""
    return _validate(CONFIG_MODELS[kind], data, "config", {"allow_local_http": allow_local_http})


def parse_secrets(kind: ConnectionKind, data: Any) -> Any:
    return _validate(SECRET_MODELS[kind], data, "secrets", {})


def reveal(secrets: BaseModel) -> dict[str, str]:
    """The plaintext secret values, by snake_case field name. Handle with care."""
    return {name: value.get_secret_value() for name, value in secrets if value is not None}


def secret_hint(secrets: BaseModel) -> str:
    """`••••` plus the last 4 characters of the (single) secret, when it is long enough."""
    (value,) = reveal(secrets).values()
    return HINT_MASK + (value[-4:] if len(value) >= HINT_MIN_SECRET_LENGTH else "")


def chat_model(kind: ConnectionKind, stored_config: dict[str, Any]) -> str | None:
    """The chat model (OpenAI) or deployment (Azure OpenAI) a stored config offers, if any.

    OpenAI always uses `CHAT_MODEL` (a legacy stored `chat_model` is ignored); Azure has no default.
    """
    if kind is ConnectionKind.OPENAI:
        return CHAT_MODEL
    if kind is ConnectionKind.AZURE_OPENAI:
        return stored_config.get("chat_deployment") or None
    return None


def config_for_api(config: dict[str, Any]) -> dict[str, Any]:
    """Stored (snake_case) config as the API shows it (camelCase)."""
    return {to_camel(key): value for key, value in config.items()}
