"""Settings read from environment variables (no secrets are ever defaulted)."""

import os
from collections.abc import Mapping
from dataclasses import dataclass


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class TtsSettings:
    provider: str = "openai"
    model: str = "gpt-4o-mini-tts"
    voice: str = "alloy"
    openai_api_key: str | None = None
    azure_api_key: str | None = None
    azure_endpoint: str | None = None
    azure_api_version: str | None = None
    azure_deployment: str | None = None

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "TtsSettings":
        env = os.environ if env is None else env
        return cls(
            provider=env.get("VOICE_EVAL_PROVIDER", "openai").strip().lower(),
            model=env.get("VOICE_EVAL_TTS_MODEL", cls.model),
            voice=env.get("VOICE_EVAL_TTS_VOICE", cls.voice),
            openai_api_key=env.get("OPENAI_API_KEY"),
            azure_api_key=env.get("AZURE_OPENAI_API_KEY"),
            azure_endpoint=env.get("AZURE_OPENAI_ENDPOINT"),
            azure_api_version=env.get("AZURE_OPENAI_API_VERSION"),
            azure_deployment=env.get("AZURE_OPENAI_TTS_DEPLOYMENT"),
        )


def require(**values: str | None) -> None:
    """Raise one ConfigError naming every missing environment variable."""
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise ConfigError(f"missing required environment variable(s): {', '.join(missing)}")
