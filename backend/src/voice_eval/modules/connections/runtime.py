"""Runtime resolver: build provider clients from the connection as it is stored right now.

Nothing is cached between calls, so an edit made through the API is used by the next run
without restarting the process.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.connections.domain import (
    ConnectionKind,
    ConnectionNotFound,
    UnsupportedConnection,
    parse_config,
    reveal,
)
from voice_eval.modules.connections.models import ConnectionRecord
from voice_eval.modules.connections.service import open_secrets
from voice_eval.platform.secrets import SecretBox
from voice_eval.ports.tts import SpeechSynthesizer
from voice_eval.providers.factory import (
    build_azure_openai_synthesizer,
    build_openai_synthesizer,
)


async def build_synthesizer(
    db: AsyncSession,
    connection_id: uuid.UUID,
    *,
    secret_box: SecretBox,
    allow_local_http: bool = False,
) -> SpeechSynthesizer:
    """A text-to-speech adapter for the stored connection `connection_id`.

    Pass `allow_local_http` as the running environment allows (see `parse_config`).
    Raises `ConnectionNotFound`, `UnsupportedConnection` for kinds that cannot synthesize, and
    `SecretDecryptionError` when the stored secret cannot be opened with the current key.
    """
    record = await db.get(ConnectionRecord, connection_id, populate_existing=True)
    if record is None:
        raise ConnectionNotFound(str(connection_id))
    kind = ConnectionKind(record.kind)
    if kind is ConnectionKind.AZURE_SPEECH:
        raise UnsupportedConnection(
            "azure_speech connections cannot synthesize speech: not implemented yet"
        )
    if kind is ConnectionKind.LANGFUSE:
        raise UnsupportedConnection("langfuse connections are not a TTS provider")
    config = parse_config(kind, record.config, allow_local_http=allow_local_http)
    secrets = reveal(open_secrets(secret_box, record))
    if kind is ConnectionKind.OPENAI:
        return build_openai_synthesizer(
            api_key=secrets["api_key"],
            model=config.tts_model,
            voice=config.tts_voice,
            base_url=config.base_url,
        )
    return build_azure_openai_synthesizer(
        api_key=secrets["api_key"],
        endpoint=config.endpoint,
        api_version=config.api_version,
        deployment=config.tts_deployment,
        voice=config.tts_voice,
    )
