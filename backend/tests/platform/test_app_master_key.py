import pytest

from voice_eval.platform.app import create_app
from voice_eval.platform.secrets import MasterKeyError
from voice_eval.platform.settings import Settings


def _settings(key):
    return Settings(
        _env_file=None, database_url="postgresql+asyncpg://u:p@db/x", voice_eval_master_key=key
    )


@pytest.mark.parametrize("key", [None, "", " , "])
def test_create_app_fails_fast_without_a_master_key(key):
    with pytest.raises(MasterKeyError):
        create_app(_settings(key))


def test_create_app_accepts_any_non_empty_master_key():
    assert create_app(_settings("short")) is not None
