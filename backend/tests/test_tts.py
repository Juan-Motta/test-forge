import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from openai import AsyncAzureOpenAI, AsyncOpenAI

from voice_eval.config import ConfigError, TtsSettings
from voice_eval.ports.tts import SynthesisError
from voice_eval.providers import build_synthesizer
from voice_eval.providers.factory import (
    build_azure_openai_synthesizer,
    build_openai_synthesizer,
)
from voice_eval.providers.openai_tts import OpenAISpeechSynthesizer

PCM = b"\x01\x00" * 100


class FakeStreamedSpeech:
    """The SDK's streamed binary response: an async context manager whose body arrives in chunks."""

    def __init__(self, chunks: list[bytes], delay_s: float = 0) -> None:
        self.chunks = chunks
        self.delay_s = delay_s
        self.entered = False
        self.closed = False

    async def __aenter__(self) -> "FakeStreamedSpeech":
        self.entered = True
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        self.closed = True

    async def iter_bytes(self, chunk_size: int | None = None):
        for chunk in self.chunks:
            await asyncio.sleep(self.delay_s)
            yield chunk


def _mock_speech(
    synth: OpenAISpeechSynthesizer, content: bytes | list[bytes] = PCM, delay_s: float = 0
) -> MagicMock:
    chunks = content if isinstance(content, list) else [content]
    response = FakeStreamedSpeech(chunks, delay_s)
    create = MagicMock(return_value=response)
    create.response = response
    synth.client.audio.speech.with_streaming_response = SimpleNamespace(create=create)
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
    create.assert_called_once_with(
        model="gpt-4o-mini-tts", voice="coral", input="hola", response_format="pcm"
    )
    assert create.response.closed


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
    create.assert_called_once_with(
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


@pytest.mark.parametrize("content", [b"", b"\x01\x02\x03", [b"\x01", b"\x02\x03"]])
async def test_adapter_rejects_empty_or_odd_pcm(content):
    synth = build_synthesizer(TtsSettings.from_env({"OPENAI_API_KEY": "test-key"}))
    _mock_speech(synth, content)
    with pytest.raises(SynthesisError):
        await synth.synthesize("hola")
    with pytest.raises(SynthesisError):
        async for _ in synth.stream("hola"):
            pass


async def test_stream_yields_even_chunks_as_they_arrive():
    synth = build_synthesizer(TtsSettings.from_env({"OPENAI_API_KEY": "test-key"}))
    # odd chunk boundaries split samples: the adapter re-aligns them to whole samples
    chunks = [b"\x01", b"\x02\x03\x04", b"", b"\x05", b"\x06\x07\x08\x09\x0a"]
    create = _mock_speech(synth, chunks)

    out = [chunk async for chunk in synth.stream("hola")]

    assert out == [b"\x01\x02\x03\x04", b"\x05\x06\x07\x08\x09\x0a"]
    assert all(len(chunk) % 2 == 0 for chunk in out)
    create.assert_called_once_with(
        model="gpt-4o-mini-tts", voice="alloy", input="hola", response_format="pcm"
    )
    assert create.response.closed


async def test_synthesize_collects_the_stream():
    synth = build_synthesizer(TtsSettings.from_env({"OPENAI_API_KEY": "test-key"}))
    _mock_speech(synth, [PCM[:51], PCM[51:120], PCM[120:]])
    assert await synth.synthesize("hola") == PCM


async def test_stream_hands_out_the_first_chunk_before_the_rest_is_synthesized():
    synth = build_synthesizer(TtsSettings.from_env({"OPENAI_API_KEY": "test-key"}))
    create = _mock_speech(synth, [PCM, PCM, PCM], delay_s=0.2)
    loop = asyncio.get_running_loop()
    started = loop.time()
    stream = synth.stream("hola")
    first = await anext(stream)
    first_s = loop.time() - started
    await stream.aclose()  # the caller stops listening: the response is released

    assert first == PCM
    assert first_s < 0.35
    assert create.response.closed


async def test_a_cancelled_stream_releases_the_response():
    synth = build_synthesizer(TtsSettings.from_env({"OPENAI_API_KEY": "test-key"}))
    create = _mock_speech(synth, [PCM, PCM], delay_s=5)

    async def consume() -> None:
        async for _ in synth.stream("hola"):
            pass

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert create.response.entered and create.response.closed


def test_synthesizers_can_be_built_from_explicit_values(monkeypatch):
    monkeypatch.setenv("OPENAI_BASE_URL", "https://ambient.example.com/v1")
    synth = build_openai_synthesizer(
        api_key="k1", model="tts-1", voice="nova", base_url="https://proxy.example.com/v1"
    )
    assert (synth.model, synth.voice, synth.client.api_key) == ("tts-1", "nova", "k1")
    assert str(synth.client.base_url) == "https://proxy.example.com/v1/"
    azure = build_azure_openai_synthesizer(
        api_key="k2",
        endpoint="https://res.openai.azure.com",
        api_version="2025-03-01-preview",
        deployment="dep",
        voice="alloy",
    )
    assert isinstance(azure.client, AsyncAzureOpenAI)
    assert (azure.model, azure.voice, azure.client.api_key) == ("dep", "alloy", "k2")
