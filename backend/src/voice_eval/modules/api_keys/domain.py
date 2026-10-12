"""API keys domain: the key format, the entity and the errors the module speaks in.

A key reads `ve_<prefix>_<secret>`: `ve_<prefix>` is shown in listings to tell keys apart, the
secret (256 bits, base62) is shown once at creation. Only the SHA-256 of the whole key is
stored: the key is a high-entropy random value, so a slow password hash would add nothing.
"""

import hashlib
import re
import secrets
import string
import uuid
from dataclasses import dataclass
from datetime import datetime

KEY_SCHEME = "ve_"
PREFIX_LENGTH = 8
SECRET_LENGTH = 43  # 43 base62 characters carry 256 bits
DISPLAY_PREFIX_LENGTH = len(KEY_SCHEME) + PREFIX_LENGTH
MAX_NAME_LENGTH = 80
MAX_EXPIRES_IN_DAYS = 3650

_PREFIX_ALPHABET = string.ascii_lowercase + string.digits
_SECRET_ALPHABET = string.ascii_letters + string.digits
KEY_PATTERN = re.compile(
    rf"(?P<prefix>{KEY_SCHEME}[a-z0-9]{{{PREFIX_LENGTH}}})_[A-Za-z0-9]{{{SECRET_LENGTH}}}"
)


@dataclass(frozen=True)
class ApiKey:
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    prefix: str  # `ve_xxxxxxxx`, never the secret
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None
    revoked_at: datetime | None


@dataclass(frozen=True)
class IssuedApiKey:
    """A freshly created key. `key` is the only copy of the raw secret."""

    api_key: ApiKey
    key: str


class ApiKeyNotFound(Exception):
    """Unknown id, or a key of another user: indistinguishable on purpose."""


def generate_key() -> str:
    prefix = "".join(secrets.choice(_PREFIX_ALPHABET) for _ in range(PREFIX_LENGTH))
    secret = "".join(secrets.choice(_SECRET_ALPHABET) for _ in range(SECRET_LENGTH))
    return f"{KEY_SCHEME}{prefix}_{secret}"


def display_prefix(key: str) -> str | None:
    """The `ve_xxxxxxxx` part of a well-formed key, else None (it is then not an API key)."""
    match = KEY_PATTERN.fullmatch(key)
    return match["prefix"] if match else None


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()
