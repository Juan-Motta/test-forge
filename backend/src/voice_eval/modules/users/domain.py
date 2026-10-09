"""Users domain: the entity and the errors the rest of the module speaks in."""

import uuid
from dataclasses import dataclass
from datetime import datetime

from email_validator import EmailNotValidError, validate_email

MIN_PASSWORD_LENGTH = 12
# Column sizes shared by the models, the API schemas and the use cases (migrations keep literals).
MAX_EMAIL_LENGTH = 320
MAX_DISPLAY_NAME_LENGTH = 200
MAX_USER_AGENT_LENGTH = 512
MAX_IP_LENGTH = 45  # the longest textual IPv6 address


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


class LoginThrottled(Exception):
    """Too many failed logins recently; says nothing about whether the account exists."""

    def __init__(self, retry_after_s: int) -> None:
        super().__init__(f"retry after {retry_after_s}s")
        self.retry_after_s = retry_after_s


class InvalidUserInput(ValueError):
    pass


def canonical_email(raw: str) -> str:
    """The single spelling an email is stored, looked up and throttled by.

    email-validator's normalized form (NFC local part, Unicode lowercase domain) lowercased.
    Raises `InvalidUserInput` when the address is not valid.
    """
    try:
        return validate_email(raw.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        raise InvalidUserInput(f"invalid email address: {exc}") from None
