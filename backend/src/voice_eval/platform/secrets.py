"""Encryption at rest for stored secrets, keyed by `VOICE_EVAL_MASTER_KEY`.

The variable holds one or more comma-separated keys: Fernet keys, or any passphrase (derived into
a Fernet key with scrypt). The first key encrypts; every key
decrypts, so a key is rotated by prepending a new one and dropping the old one once every
stored secret has been re-saved. Each token embeds the id and kind of the row that owns it, and
opening it with another owner fails, so ciphertext cannot be swapped between rows.

Error messages never include key material, tokens or plaintext.
"""

import base64
import hashlib
import json
import uuid
from collections.abc import Mapping
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from fastapi import Request

from voice_eval.platform.settings import Settings

ENVELOPE_VERSION = 1
PASSPHRASE_SALT = b"voice-eval/master-key/v1"


class MasterKeyError(RuntimeError):
    """`VOICE_EVAL_MASTER_KEY` is missing or malformed."""


class SecretDecryptionError(RuntimeError):
    """A stored secret cannot be opened (wrong key, tampered, or owned by another row)."""


def _fernet_for(key: str) -> Fernet:
    """A Fernet key is used as-is; any other value is a passphrase stretched into one with scrypt.

    The salt is fixed so the same passphrase always yields the same key across restarts. Weak
    passphrases are accepted by design; their strength is the operator's responsibility.
    """
    try:
        return Fernet(key)
    except (ValueError, TypeError):
        derived = hashlib.scrypt(key.encode(), salt=PASSPHRASE_SALT, n=2**14, r=8, p=1, dklen=32)
        return Fernet(base64.urlsafe_b64encode(derived))


class SecretBox:
    def __init__(self, fernet: MultiFernet) -> None:
        self._fernet = fernet

    @classmethod
    def from_master_key(cls, raw: str | None) -> "SecretBox":
        keys = [part.strip() for part in (raw or "").split(",") if part.strip()]
        if not keys:
            raise MasterKeyError(
                "VOICE_EVAL_MASTER_KEY is not set; generate one with "
                "`python -c 'from cryptography.fernet import Fernet; "
                "print(Fernet.generate_key().decode())'`"
            )
        return cls(MultiFernet([_fernet_for(key) for key in keys]))

    @classmethod
    def from_settings(cls, settings: Settings) -> "SecretBox":
        key = settings.voice_eval_master_key
        return cls.from_master_key(key.get_secret_value() if key else None)

    def seal(self, payload: Mapping[str, Any], *, owner: uuid.UUID, kind: str) -> str:
        envelope = {"v": ENVELOPE_VERSION, "owner": str(owner), "kind": kind, "data": payload}
        return self._fernet.encrypt(json.dumps(envelope).encode()).decode()

    def open(self, token: str, *, owner: uuid.UUID, kind: str) -> dict[str, str]:
        """The sealed payload; `SecretDecryptionError` for any token that is not one of ours."""
        try:
            envelope = json.loads(self._fernet.decrypt(token.encode()))
        except (InvalidToken, ValueError):
            raise SecretDecryptionError(
                "stored secret could not be decrypted (wrong VOICE_EVAL_MASTER_KEY?)"
            ) from None
        if not isinstance(envelope, dict) or envelope.get("v") != ENVELOPE_VERSION:
            raise SecretDecryptionError("stored secret has an unknown format")
        if envelope.get("owner") != str(owner) or envelope.get("kind") != kind:
            raise SecretDecryptionError("stored secret does not belong to this connection")
        data = envelope.get("data")
        if not isinstance(data, dict) or not all(
            isinstance(key, str) and isinstance(value, str) for key, value in data.items()
        ):
            raise SecretDecryptionError("stored secret has an unknown format")
        return data


def app_secret_box(request: Request) -> SecretBox:
    """FastAPI dependency: the secret box the running app was built with."""
    return request.app.state.secret_box
