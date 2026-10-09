"""Backend settings from the environment (and `backend/.env` when present).

`backend/.env` is found from this file's location, not the working directory, so commands
behave the same from the repository root or from `backend/`. Environment variables win over it.

No secret is ever defaulted. `VOICE_EVAL_MASTER_KEY` is optional here so the CLI can migrate
and create users without it; the HTTP app refuses to start without a valid one. Anything that
loosens security is opt-in: `ENVIRONMENT` defaults to `production`.
"""

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import Request
from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[3]  # backend/src/voice_eval/platform/settings.py
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    database_url: str
    voice_eval_master_key: SecretStr | None = None
    session_ttl_hours: int = Field(default=12, gt=0)
    session_cookie_name: str = "ve_session"
    session_cookie_secure: bool = True
    web_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    environment: str = "production"  # only exactly `development` serves the API docs
    login_max_failures_per_email: int = Field(default=5, gt=0)
    login_max_failures_per_ip: int = Field(default=20, gt=0)
    login_window_minutes: int = Field(default=15, gt=0)

    @field_validator("database_url")
    @classmethod
    def _async_postgres(cls, value: str) -> str:
        if not value.startswith("postgresql+asyncpg://"):
            raise ValueError("DATABASE_URL must start with postgresql+asyncpg://")
        return value

    @field_validator("web_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.split(",")
        if isinstance(value, list):
            return [str(origin).strip().rstrip("/") for origin in value if str(origin).strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


def app_settings(request: Request) -> Settings:
    """FastAPI dependency: the settings the running app was built with."""
    return request.app.state.settings
