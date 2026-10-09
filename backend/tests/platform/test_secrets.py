import json
import uuid

import pytest
from cryptography.fernet import Fernet

from voice_eval.platform.secrets import MasterKeyError, SecretBox, SecretDecryptionError

OWNER = uuid.uuid4()
PAYLOAD = {"api_key": "sk-test-0123456789abcdef"}


def _key() -> str:
    return Fernet.generate_key().decode()


def test_seal_and_open_round_trip_without_plaintext_in_the_token():
    box = SecretBox.from_master_key(_key())
    token = box.seal(PAYLOAD, owner=OWNER, kind="openai")
    assert "sk-test" not in token
    assert box.open(token, owner=OWNER, kind="openai") == PAYLOAD


def test_rotation_new_key_first_still_opens_old_tokens():
    old, new = _key(), _key()
    old_token = SecretBox.from_master_key(old).seal(PAYLOAD, owner=OWNER, kind="openai")
    rotated = SecretBox.from_master_key(f"{new}, {old}")
    assert rotated.open(old_token, owner=OWNER, kind="openai") == PAYLOAD
    new_token = rotated.seal(PAYLOAD, owner=OWNER, kind="openai")
    # sealed with the first key only: a box holding just the new key opens it
    assert SecretBox.from_master_key(new).open(new_token, owner=OWNER, kind="openai") == PAYLOAD
    with pytest.raises(SecretDecryptionError):
        SecretBox.from_master_key(old).open(new_token, owner=OWNER, kind="openai")


def test_token_bound_to_its_owner_and_kind():
    box = SecretBox.from_master_key(_key())
    token = box.seal(PAYLOAD, owner=OWNER, kind="openai")
    with pytest.raises(SecretDecryptionError, match="does not belong"):
        box.open(token, owner=uuid.uuid4(), kind="openai")
    with pytest.raises(SecretDecryptionError, match="does not belong"):
        box.open(token, owner=OWNER, kind="azure_openai")


def test_wrong_key_or_garbage_fails_without_detail():
    token = SecretBox.from_master_key(_key()).seal(PAYLOAD, owner=OWNER, kind="openai")
    other = SecretBox.from_master_key(_key())
    with pytest.raises(SecretDecryptionError) as wrong:
        other.open(token, owner=OWNER, kind="openai")
    assert token not in str(wrong.value)
    with pytest.raises(SecretDecryptionError):
        other.open("not-a-token", owner=OWNER, kind="openai")


@pytest.mark.parametrize("raw", [None, "", " , "])
def test_missing_master_key_is_rejected(raw):
    with pytest.raises(MasterKeyError, match="VOICE_EVAL_MASTER_KEY"):
        SecretBox.from_master_key(raw)


def test_invalid_master_key_message_has_no_key_material():
    good = _key()
    bad = "this-is-not-a-fernet-key-but-a-secret"
    with pytest.raises(MasterKeyError) as info:
        SecretBox.from_master_key(f"{good},{bad}")
    message = str(info.value)
    assert "VOICE_EVAL_MASTER_KEY" in message and "#2" in message
    assert bad not in message and good not in message
    assert info.value.__cause__ is None and info.value.__suppress_context__


@pytest.mark.parametrize(
    "envelope",
    [
        ["not", "a", "mapping"],
        {"v": 2, "owner": str(OWNER), "kind": "openai", "data": PAYLOAD},  # unknown version
        {"owner": str(OWNER), "kind": "openai", "data": PAYLOAD},  # no version
        {"v": 1, "owner": str(OWNER), "kind": "openai"},  # no data
        {"v": 1, "owner": str(OWNER), "kind": "openai", "data": "sk-test-not-a-mapping"},
        {"v": 1, "owner": str(OWNER), "kind": "openai", "data": {"api_key": 42}},
    ],
)
def test_malformed_envelope_is_a_decryption_error(envelope):
    key = _key()
    token = Fernet(key).encrypt(json.dumps(envelope).encode()).decode()
    with pytest.raises(SecretDecryptionError) as info:
        SecretBox.from_master_key(key).open(token, owner=OWNER, kind="openai")
    assert "sk-test" not in str(info.value)
