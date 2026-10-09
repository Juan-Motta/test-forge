import pytest

from voice_eval.platform.app import create_app
from voice_eval.platform.secrets import MasterKeyError
from voice_eval.platform.settings import Settings


@pytest.mark.parametrize("key", [None, "short"])
def test_create_app_fails_fast_without_a_valid_master_key(key):
    settings = Settings(
        _env_file=None, database_url="postgresql+asyncpg://u:p@db/x", voice_eval_master_key=key
    )
    with pytest.raises(MasterKeyError) as info:
        create_app(settings)
    assert "short" not in str(info.value)
