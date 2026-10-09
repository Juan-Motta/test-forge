"""Users domain: the entity and the errors the rest of the module speaks in."""

import uuid
from dataclasses import dataclass
from datetime import datetime

MIN_PASSWORD_LENGTH = 12


@dataclass(frozen=True)
class User:
    id: uuid.UUID
    email: str
    display_name: str
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


@dataclass(frozen=True)
class IssuedSession:
    """A freshly created session. `token` is the only copy of the raw secret."""

    user: User
    token: str
    expires_at: datetime


class InvalidCredentials(Exception):
    """Login failed. Deliberately says nothing about which part was wrong."""


class UserAlreadyExists(Exception):
    pass


class InvalidUserInput(ValueError):
    pass


def normalize_email(email: str) -> str:
    return email.strip().lower()
