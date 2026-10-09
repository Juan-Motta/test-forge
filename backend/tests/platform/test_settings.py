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
    assert settings.environment == "production"
    assert settings.login_max_failures_per_email == 5
    assert settings.login_max_failures_per_ip == 20
    assert settings.login_window_minutes == 15


def test_login_throttle_is_configurable(monkeypatch):
    monkeypatch.setenv("LOGIN_MAX_FAILURES_PER_EMAIL", "3")
    monkeypatch.setenv("LOGIN_MAX_FAILURES_PER_IP", "50")
    monkeypatch.setenv("LOGIN_WINDOW_MINUTES", "5")
    settings = Settings(_env_file=None, database_url=DB_URL)
    assert (
        settings.login_max_failures_per_email,
        settings.login_max_failures_per_ip,
        settings.login_window_minutes,
    ) == (3, 50, 5)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, database_url=DB_URL, login_window_minutes=0)


def test_master_key_is_secret(monkeypatch):
    monkeypatch.setenv("VOICE_EVAL_MASTER_KEY", "not-a-real-key")
    settings = Settings(_env_file=None, database_url=DB_URL)
    assert settings.voice_eval_master_key.get_secret_value() == "not-a-real-key"
    assert "not-a-real-key" not in repr(settings)


def test_database_url_must_use_asyncpg():
    with pytest.raises(ValidationError, match="postgresql\\+asyncpg"):
        Settings(_env_file=None, database_url="postgresql://u:p@localhost/db")
