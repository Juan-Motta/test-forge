"""Password hashing with argon2id (pwdlib defaults, upgraded transparently on login)."""

from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError
from pwdlib.hashers.argon2 import Argon2Hasher

_hasher = PasswordHash((Argon2Hasher(),))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return verify_and_update(password, password_hash)[0]


def verify_and_update(password: str, password_hash: str) -> tuple[bool, str | None]:
    """Return (valid, new_hash); `new_hash` is set only when the stored hash is outdated."""
    try:
        return _hasher.verify_and_update(password, password_hash)
    except UnknownHashError:
        return False, None
