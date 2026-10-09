import pytest
from pydantic import ValidationError

from voice_eval.platform.settings import Settings

DB_URL = "postgresql+asyncpg://u:p@localhost:5432/db"


def test_defaults_and_comma_separated_origins(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", DB_URL)
    monkeypatch.setenv("WEB_ORIGINS", "http://localhost:3000, https://eval.example.com/")
    settings = Settings(_env_file=None)
    assert settings.database_url == DB_URL
    assert settings.web_origins == ["http://localhost:3000", "https://eval.example.com"]
    assert settings.session_ttl_hours == 12
    assert settings.session_cookie_name == "ve_session"
    assert settings.session_cookie_secure is True
    assert settings.voice_eval_master_key is None


def test_master_key_is_secret(monkeypatch):
    monkeypatch.setenv("VOICE_EVAL_MASTER_KEY", "not-a-real-key")
    settings = Settings(_env_file=None, database_url=DB_URL)
    assert settings.voice_eval_master_key.get_secret_value() == "not-a-real-key"
    assert "not-a-real-key" not in repr(settings)


def test_database_url_must_use_asyncpg():
    with pytest.raises(ValidationError, match="postgresql\\+asyncpg"):
        Settings(_env_file=None, database_url="postgresql://u:p@localhost/db")
