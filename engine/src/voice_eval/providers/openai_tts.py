"""OpenAI / Azure OpenAI text-to-speech adapter for the SpeechSynthesizer port."""

from openai import AsyncAzureOpenAI, AsyncOpenAI

from voice_eval.ports.tts import SynthesisError


class OpenAISpeechSynthesizer:
    def __init__(self, client: AsyncOpenAI, model: str, voice: str) -> None:
        self.client = client
        self.model = model
        self.voice = voice

    @classmethod
    def for_openai(cls, api_key: str, model: str, voice: str) -> "OpenAISpeechSynthesizer":
        return cls(AsyncOpenAI(api_key=api_key), model, voice)

    @classmethod
    def for_azure(
        cls, api_key: str, endpoint: str, api_version: str, deployment: str, voice: str
    ) -> "OpenAISpeechSynthesizer":
        client = AsyncAzureOpenAI(api_key=api_key, azure_endpoint=endpoint, api_version=api_version)
        # Azure routes by deployment name, which goes in the `model` field.
        return cls(client, deployment, voice)

    async def synthesize(self, text: str) -> bytes:
        # "pcm" is raw 24 kHz 16-bit signed little-endian mono with no header, which is
        # exactly the target's wire format, so no resampling is needed.
        response = await self.client.audio.speech.create(
            model=self.model, voice=self.voice, input=text, response_format="pcm"
        )
        pcm = response.content
        if not pcm or len(pcm) % 2:
            raise SynthesisError(f"TTS returned invalid PCM16 payload ({len(pcm)} bytes)")
        return pcm
