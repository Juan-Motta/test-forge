from typing import TYPE_CHECKING

from voice_eval.config import ConfigError, TtsSettings, require
from voice_eval.ports.judge import RunJudgeModel
from voice_eval.ports.policy import CallerPolicy
from voice_eval.ports.realtime_caller import RealtimeCaller
from voice_eval.ports.tts import SpeechSynthesizer

if TYPE_CHECKING:
    from voice_eval.providers.langfuse_traces import LangfuseTraceReader

SUPPORTED_PROVIDERS = ("openai", "azure", "azure_speech")


def build_openai_synthesizer(
    *, api_key: str, model: str, voice: str, base_url: str | None = None
) -> SpeechSynthesizer:
    from voice_eval.providers.openai_tts import OpenAISpeechSynthesizer

    return OpenAISpeechSynthesizer.for_openai(api_key, model, voice, base_url=base_url)


def build_azure_openai_synthesizer(
    *,
    api_key: str,
    endpoint: str,
    api_version: str,
    deployment: str,
    voice: str,
    usage_model: str | None = None,
) -> SpeechSynthesizer:
    """`usage_model`: the model the deployment serves, which its usage is priced as."""
    from voice_eval.providers.openai_tts import OpenAISpeechSynthesizer

    return OpenAISpeechSynthesizer.for_azure(
        api_key, endpoint, api_version, deployment, voice, usage_model=usage_model
    )


def build_openai_realtime_caller(
    *, api_key: str, model: str, voice: str, base_url: str
) -> RealtimeCaller:
    from voice_eval.providers.openai_realtime_caller import OpenAIRealtimeCaller

    return OpenAIRealtimeCaller.for_openai(api_key, model=model, voice=voice, base_url=base_url)


def build_azure_openai_realtime_caller(
    *, api_key: str, endpoint: str, deployment: str, voice: str, usage_model: str | None = None
) -> RealtimeCaller:
    from voice_eval.providers.openai_realtime_caller import OpenAIRealtimeCaller

    return OpenAIRealtimeCaller.for_azure(
        api_key, endpoint=endpoint, deployment=deployment, voice=voice, usage_model=usage_model
    )


def build_openai_policy(*, api_key: str, model: str, base_url: str | None = None) -> CallerPolicy:
    from voice_eval.providers.openai_chat import OpenAIChatPolicy

    return OpenAIChatPolicy.for_openai(api_key, model, base_url=base_url)


def build_azure_openai_policy(
    *,
    api_key: str,
    endpoint: str,
    api_version: str,
    deployment: str,
    usage_model: str | None = None,
) -> CallerPolicy:
    from voice_eval.providers.openai_chat import OpenAIChatPolicy

    return OpenAIChatPolicy.for_azure(
        api_key, endpoint, api_version, deployment, usage_model=usage_model
    )


def build_openai_judge(*, api_key: str, model: str, base_url: str | None = None) -> RunJudgeModel:
    from voice_eval.providers.openai_chat import OpenAIJudge

    return OpenAIJudge.for_openai(api_key, model, base_url=base_url)


def build_azure_openai_judge(
    *,
    api_key: str,
    endpoint: str,
    api_version: str,
    deployment: str,
    usage_model: str | None = None,
) -> RunJudgeModel:
    from voice_eval.providers.openai_chat import OpenAIJudge

    return OpenAIJudge.for_azure(
        api_key, endpoint, api_version, deployment, usage_model=usage_model
    )


def build_langfuse_trace_reader(
    *, host: str, public_key: str, secret_key: str, allow_private: bool = False
) -> "LangfuseTraceReader":
    from voice_eval.providers.langfuse_traces import LangfuseTraceReader

    return LangfuseTraceReader(host, public_key, secret_key, allow_private=allow_private)


def build_synthesizer(settings: TtsSettings) -> SpeechSynthesizer:
    """Build the synthesizer from environment settings (the CLI probe's path)."""
    match settings.provider:
        case "openai":
            require(OPENAI_API_KEY=settings.openai_api_key)
            return build_openai_synthesizer(
                api_key=settings.openai_api_key, model=settings.model, voice=settings.voice
            )
        case "azure":
            require(
                AZURE_OPENAI_API_KEY=settings.azure_api_key,
                AZURE_OPENAI_ENDPOINT=settings.azure_endpoint,
                AZURE_OPENAI_API_VERSION=settings.azure_api_version,
                AZURE_OPENAI_TTS_DEPLOYMENT=settings.azure_deployment,
            )
            return build_azure_openai_synthesizer(
                api_key=settings.azure_api_key,
                endpoint=settings.azure_endpoint,
                api_version=settings.azure_api_version,
                deployment=settings.azure_deployment,
                voice=settings.voice,
            )
        case "azure_speech":
            raise NotImplementedError("VOICE_EVAL_PROVIDER=azure_speech is not implemented yet")
        case other:
            raise ConfigError(
                f"unknown VOICE_EVAL_PROVIDER={other!r}; expected one of {SUPPORTED_PROVIDERS}"
            )
