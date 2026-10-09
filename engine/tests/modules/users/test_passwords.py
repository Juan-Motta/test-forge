from pwdlib.hashers.argon2 import Argon2Hasher

from voice_eval.modules.users.passwords import hash_password, verify_and_update, verify_password


def test_hash_is_argon2id_and_salted():
    first, second = hash_password("s3cret-pass"), hash_password("s3cret-pass")
    assert first.startswith("$argon2id$")
    assert first != second
    assert "s3cret-pass" not in first


def test_verify_accepts_right_and_rejects_wrong_password():
    stored = hash_password("s3cret-pass")
    assert verify_password("s3cret-pass", stored)
    assert not verify_password("wrong-pass", stored)


def test_verify_rejects_malformed_hash():
    assert not verify_password("s3cret-pass", "not-a-hash")


def test_outdated_parameters_are_rehashed():
    weak = Argon2Hasher(time_cost=1, memory_cost=8192, parallelism=1).hash("s3cret-pass")
    valid, updated = verify_and_update("s3cret-pass", weak)
    assert valid
    assert updated is not None and updated != weak
    assert verify_password("s3cret-pass", updated)
    assert verify_and_update("s3cret-pass", updated) == (True, None)
    assert verify_and_update("wrong-pass", weak) == (False, None)
