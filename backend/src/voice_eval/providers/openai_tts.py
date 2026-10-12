"""OpenAI / Azure OpenAI text-to-speech adapter for the SpeechSynthesizer port."""

from collections.abc import AsyncIterator

from openai import AsyncAzureOpenAI, AsyncOpenAI

from voice_eval.ports.tts import SynthesisError


class OpenAISpeechSynthesizer:
    def __init__(self, client: AsyncOpenAI, model: str, voice: str) -> None:
        self.client = client
        self.model = model
        self.voice = voice

    @classmethod
    def for_openai(
        cls, api_key: str, model: str, voice: str, *, base_url: str | None = None
    ) -> "OpenAISpeechSynthesizer":
        # base_url None keeps the SDK default (OPENAI_BASE_URL or api.openai.com).
        return cls(AsyncOpenAI(api_key=api_key, base_url=base_url), model, voice)

    @classmethod
    def for_azure(
        cls, api_key: str, endpoint: str, api_version: str, deployment: str, voice: str
    ) -> "OpenAISpeechSynthesizer":
        client = AsyncAzureOpenAI(api_key=api_key, azure_endpoint=endpoint, api_version=api_version)
        # Azure routes by deployment name, which goes in the `model` field.
        return cls(client, deployment, voice)

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
            async for chunk in response.iter_bytes():
                data = carry + chunk
                whole = len(data) - len(data) % 2
                carry = data[whole:]
                if whole:
                    total += whole
                    yield data[:whole]
        if not total or carry:
            raise SynthesisError(f"TTS returned invalid PCM16 payload ({total + len(carry)} bytes)")
