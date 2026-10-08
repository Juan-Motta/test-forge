from voice_eval.config import ConfigError, TtsSettings, require
from voice_eval.ports.tts import SpeechSynthesizer

SUPPORTED_PROVIDERS = ("openai", "azure", "azure_speech")


def build_synthesizer(settings: TtsSettings) -> SpeechSynthesizer:
    match settings.provider:
        case "openai":
            require(OPENAI_API_KEY=settings.openai_api_key)
            from voice_eval.providers.openai_tts import OpenAISpeechSynthesizer

            return OpenAISpeechSynthesizer.for_openai(
                settings.openai_api_key, settings.model, settings.voice
            )
        case "azure":
            require(
                AZURE_OPENAI_API_KEY=settings.azure_api_key,
                AZURE_OPENAI_ENDPOINT=settings.azure_endpoint,
                AZURE_OPENAI_API_VERSION=settings.azure_api_version,
                AZURE_OPENAI_TTS_DEPLOYMENT=settings.azure_deployment,
            )
            from voice_eval.providers.openai_tts import OpenAISpeechSynthesizer

            return OpenAISpeechSynthesizer.for_azure(
                settings.azure_api_key,
                settings.azure_endpoint,
                settings.azure_api_version,
                settings.azure_deployment,
                settings.voice,
            )
        case "azure_speech":
            raise NotImplementedError("VOICE_EVAL_PROVIDER=azure_speech is not implemented yet")
        case other:
            raise ConfigError(
                f"unknown VOICE_EVAL_PROVIDER={other!r}; expected one of {SUPPORTED_PROVIDERS}"
            )
