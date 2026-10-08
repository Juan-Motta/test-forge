from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from openai import AsyncAzureOpenAI, AsyncOpenAI

from voice_eval.config import ConfigError, TtsSettings
from voice_eval.ports.tts import SynthesisError
from voice_eval.providers import build_synthesizer
from voice_eval.providers.openai_tts import OpenAISpeechSynthesizer

PCM = b"\x01\x00" * 100


def _mock_speech(synth: OpenAISpeechSynthesizer, content: bytes = PCM) -> AsyncMock:
    create = AsyncMock(return_value=SimpleNamespace(content=content))
    synth.client.audio.speech.create = create
    return create


def test_settings_default_to_openai_with_defaults():
    s = TtsSettings.from_env({"OPENAI_API_KEY": "test-key"})
    assert (s.provider, s.model, s.voice) == ("openai", "gpt-4o-mini-tts", "alloy")


async def test_openai_adapter_requests_raw_pcm_with_model():
    s = TtsSettings.from_env({"OPENAI_API_KEY": "test-key", "VOICE_EVAL_TTS_VOICE": "coral"})
    synth = build_synthesizer(s)
    assert isinstance(synth.client, AsyncOpenAI)
    assert not isinstance(synth.client, AsyncAzureOpenAI)
    create = _mock_speech(synth)
    assert await synth.synthesize("hola") == PCM
    create.assert_awaited_once_with(
        model="gpt-4o-mini-tts", voice="coral", input="hola", response_format="pcm"
    )


async def test_azure_adapter_uses_deployment_as_model():
    env = {
        "VOICE_EVAL_PROVIDER": "azure",
        "AZURE_OPENAI_API_KEY": "test-key",
        "AZURE_OPENAI_ENDPOINT": "https://example.invalid",
        "AZURE_OPENAI_API_VERSION": "2025-03-01-preview",
        "AZURE_OPENAI_TTS_DEPLOYMENT": "my-tts",
    }
    synth = build_synthesizer(TtsSettings.from_env(env))
    assert isinstance(synth.client, AsyncAzureOpenAI)
    create = _mock_speech(synth)
    await synth.synthesize("hola")
    create.assert_awaited_once_with(
        model="my-tts", voice="alloy", input="hola", response_format="pcm"
    )


def test_missing_required_env_var_is_named():
    with pytest.raises(ConfigError, match="AZURE_OPENAI_ENDPOINT"):
        build_synthesizer(
            TtsSettings.from_env({"VOICE_EVAL_PROVIDER": "azure", "AZURE_OPENAI_API_KEY": "k"})
        )
    with pytest.raises(ConfigError, match="OPENAI_API_KEY"):
        build_synthesizer(TtsSettings.from_env({}))


def test_azure_speech_is_not_implemented_yet():
    with pytest.raises(NotImplementedError, match="azure_speech"):
        build_synthesizer(TtsSettings.from_env({"VOICE_EVAL_PROVIDER": "azure_speech"}))


def test_unknown_provider_is_rejected():
    with pytest.raises(ConfigError, match="VOICE_EVAL_PROVIDER"):
        build_synthesizer(TtsSettings.from_env({"VOICE_EVAL_PROVIDER": "nope"}))


@pytest.mark.parametrize("content", [b"", b"\x01\x02\x03"])
async def test_adapter_rejects_empty_or_odd_pcm(content):
    synth = build_synthesizer(TtsSettings.from_env({"OPENAI_API_KEY": "test-key"}))
    _mock_speech(synth, content)
    with pytest.raises(SynthesisError):
        await synth.synthesize("hola")
