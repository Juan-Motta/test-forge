"""Encryption at rest for stored secrets, keyed by `VOICE_EVAL_MASTER_KEY`.

The variable holds one or more comma-separated Fernet keys. The first key encrypts; every key
decrypts, so a key is rotated by prepending a new one and dropping the old one once every
stored secret has been re-saved. Each token embeds the id and kind of the row that owns it, and
opening it with another owner fails, so ciphertext cannot be swapped between rows.

Error messages never include key material, tokens or plaintext.
"""

import json
import uuid
from collections.abc import Mapping
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from fastapi import Request

from voice_eval.platform.settings import Settings

ENVELOPE_VERSION = 1


class MasterKeyError(RuntimeError):
    """`VOICE_EVAL_MASTER_KEY` is missing or malformed."""


class SecretDecryptionError(RuntimeError):
    """A stored secret cannot be opened (wrong key, tampered, or owned by another row)."""


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
        fernets = []
        for position, key in enumerate(keys, start=1):
            try:
                fernets.append(Fernet(key))
            except (ValueError, TypeError):
                raise MasterKeyError(
                    f"VOICE_EVAL_MASTER_KEY key #{position} is not a valid Fernet key "
                    "(32 url-safe base64-encoded bytes)"
                ) from None
        return cls(MultiFernet(fernets))

    @classmethod
    def from_settings(cls, settings: Settings) -> "SecretBox":
        key = settings.voice_eval_master_key
        return cls.from_master_key(key.get_secret_value() if key else None)

    def seal(self, payload: Mapping[str, Any], *, owner: uuid.UUID, kind: str) -> str:
        envelope = {"v": ENVELOPE_VERSION, "owner": str(owner), "kind": kind, "data": payload}
        return self._fernet.encrypt(json.dumps(envelope).encode()).decode()

    def open(self, token: str, *, owner: uuid.UUID, kind: str) -> dict[str, Any]:
        try:
            envelope = json.loads(self._fernet.decrypt(token.encode()))
        except (InvalidToken, ValueError):
            raise SecretDecryptionError(
                "stored secret could not be decrypted (wrong VOICE_EVAL_MASTER_KEY?)"
            ) from None
        if envelope.get("owner") != str(owner) or envelope.get("kind") != kind:
            raise SecretDecryptionError("stored secret does not belong to this connection")
        return envelope["data"]


def app_secret_box(request: Request) -> SecretBox:
    """FastAPI dependency: the secret box the running app was built with."""
    return request.app.state.secret_box
