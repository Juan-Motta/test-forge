"""Backend settings from the environment (and `engine/.env` when present).

No secret is ever defaulted. `VOICE_EVAL_MASTER_KEY` is optional until stored connections
need it.
"""

from functools import lru_cache
from typing import Annotated

from fastapi import Request
from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    voice_eval_master_key: SecretStr | None = None
    session_ttl_hours: int = Field(default=12, gt=0)
    session_cookie_name: str = "ve_session"
    session_cookie_secure: bool = True
    web_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    environment: str = "development"

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
