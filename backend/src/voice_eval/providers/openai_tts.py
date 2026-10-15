"""OpenAI / Azure OpenAI text-to-speech adapter for the SpeechSynthesizer port.

The speech endpoint answers with the raw audio only (no `usage` object, no usage event in the
PCM stream), so the `usage` meter gets an estimate of the input text tokens (4 characters a
token, rounded up) under `usage_model`, and notes that the text is estimated and the audio
output is not metered (no tokens-per-second rate is assumed).
"""

import math
from collections.abc import AsyncIterator

from openai import AsyncAzureOpenAI, AsyncOpenAI

from voice_eval.ports.tts import SynthesisError
from voice_eval.ports.usage import TTS_AUDIO_NOT_METERED, TTS_TEXT_ESTIMATED, UsageMeter

CHARS_PER_TOKEN = 4  # a rough English average; no tokenizer is a dependency


class OpenAISpeechSynthesizer:
    def __init__(
        self, client: AsyncOpenAI, model: str, voice: str, *, usage_model: str | None = None
    ) -> None:
        self.client = client
        self.model = model
        self.voice = voice
        self.usage_model = usage_model or model
        self.usage = UsageMeter()

    @classmethod
    def for_openai(
        cls, api_key: str, model: str, voice: str, *, base_url: str | None = None
    ) -> "OpenAISpeechSynthesizer":
        # base_url None keeps the SDK default (OPENAI_BASE_URL or api.openai.com).
        return cls(AsyncOpenAI(api_key=api_key, base_url=base_url), model, voice)

    @classmethod
    def for_azure(
        cls,
        api_key: str,
        endpoint: str,
        api_version: str,
        deployment: str,
        voice: str,
        *,
        usage_model: str | None = None,
    ) -> "OpenAISpeechSynthesizer":
        client = AsyncAzureOpenAI(api_key=api_key, azure_endpoint=endpoint, api_version=api_version)
        # Azure routes by deployment name, which goes in the `model` field.
        return cls(client, deployment, voice, usage_model=usage_model)

    async def synthesize(self, text: str) -> bytes:
        return b"".join([chunk async for chunk in self.stream(text)])

    async def stream(self, text: str) -> AsyncIterator[bytes]:
        # "pcm" is raw 24 kHz 16-bit signed little-endian mono with no header, which is
        # exactly the target's wire format, so no resampling is needed. The body is read as it
        # arrives; a chunk may split a sample, so an odd byte waits for the next chunk.
        total, carry = 0, b""
        async with self.client.audio.speech.with_streaming_response.create(
            model=self.model, voice=self.voice, input=text, response_format="pcm"
        ) as response:
            # accepted: metered once, whether or not the audio is then read to the end
            self.usage.add(self.usage_model, text_in=math.ceil(len(text) / CHARS_PER_TOKEN))
            self.usage.note(TTS_TEXT_ESTIMATED)
            self.usage.note(TTS_AUDIO_NOT_METERED)
            async for chunk in response.iter_bytes():
                data = carry + chunk
                whole = len(data) - len(data) % 2
                carry = data[whole:]
                if whole:
                    total += whole
                    yield data[:whole]
        if not total or carry:
            raise SynthesisError(f"TTS returned invalid PCM16 payload ({total + len(carry)} bytes)")
