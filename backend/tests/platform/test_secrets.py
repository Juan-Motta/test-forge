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


@pytest.mark.parametrize("passphrase", ["short", "this-is-not-a-fernet-key", "spaces are fine"])
def test_any_passphrase_is_accepted_and_derivation_is_stable(passphrase):
    token = SecretBox.from_master_key(passphrase).seal(PAYLOAD, owner=OWNER, kind="openai")
    reopened = SecretBox.from_master_key(passphrase).open(token, owner=OWNER, kind="openai")
    assert reopened == PAYLOAD
    assert passphrase not in token
    with pytest.raises(SecretDecryptionError):
        SecretBox.from_master_key(passphrase + "x").open(token, owner=OWNER, kind="openai")


def test_valid_fernet_key_is_used_as_is():
    key = _key()
    token = Fernet(key).encrypt(
        b'{"v": 1, "owner": "%s", "kind": "openai", "data": {"api_key": "k"}}' % str(OWNER).encode()
    )
    opened = SecretBox.from_master_key(key).open(token.decode(), owner=OWNER, kind="openai")
    assert opened == {"api_key": "k"}


def test_passphrase_and_fernet_keys_can_be_mixed_for_rotation():
    old = _key()
    token = SecretBox.from_master_key(old).seal(PAYLOAD, owner=OWNER, kind="openai")
    rotated = SecretBox.from_master_key(f"my new passphrase,{old}")
    assert rotated.open(token, owner=OWNER, kind="openai") == PAYLOAD


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
