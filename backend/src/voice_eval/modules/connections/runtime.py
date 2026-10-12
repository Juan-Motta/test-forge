"""Runtime resolver: build provider clients from the connection as it is stored right now.

Nothing is cached between calls, so an edit made through the API is used by the next run
without restarting the process.
"""

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
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
from voice_eval.platform.db import create_engine, create_sessionmaker
from voice_eval.platform.secrets import SecretBox
from voice_eval.platform.settings import Settings
from voice_eval.ports.judge import RunJudgeModel
from voice_eval.ports.policy import CallerPolicy
from voice_eval.ports.realtime_caller import RealtimeCaller, realtime_voice
from voice_eval.ports.tts import SpeechSynthesizer
from voice_eval.providers.factory import (
    build_azure_openai_judge,
    build_azure_openai_policy,
    build_azure_openai_realtime_caller,
    build_azure_openai_synthesizer,
    build_langfuse_trace_reader,
    build_openai_judge,
    build_openai_policy,
    build_openai_realtime_caller,
    build_openai_synthesizer,
)

if TYPE_CHECKING:
    from voice_eval.providers.langfuse_traces import LangfuseTraceReader


async def resolve_connection_id(db: AsyncSession, ref: str) -> uuid.UUID:
    """The id of the connection named `ref`, or `ref` itself when it is an existing id."""
    try:
        candidate = uuid.UUID(ref)
    except ValueError:
        candidate = None
    if candidate is not None and await db.get(ConnectionRecord, candidate) is not None:
        return candidate
    found = await db.scalar(select(ConnectionRecord.id).where(ConnectionRecord.name == ref))
    if found is None:
        raise ConnectionNotFound(ref)
    return found


async def synthesizer_for_ref(ref: str, settings: Settings) -> SpeechSynthesizer:
    """Standalone entry point (CLI): open the database, resolve `ref` and build its synthesizer."""
    engine = create_engine(settings.database_url)
    try:
        async with create_sessionmaker(engine)() as session:
            connection_id = await resolve_connection_id(session, ref)
            return await build_synthesizer(
                session,
                connection_id,
                secret_box=SecretBox.from_settings(settings),
                allow_local_http=settings.environment == "development",
            )
    finally:
        await engine.dispose()


async def build_synthesizer(
    db: AsyncSession,
    connection_id: uuid.UUID,
    *,
    secret_box: SecretBox,
    allow_local_http: bool = False,
    voice: str | None = None,
) -> SpeechSynthesizer:
    """A text-to-speech adapter for the stored connection `connection_id`.

    `voice` overrides the connection's voice (a scenario's `voiceOverride`).
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
            voice=voice or config.tts_voice,
            base_url=config.base_url,
        )
    return build_azure_openai_synthesizer(
        api_key=secrets["api_key"],
        endpoint=config.endpoint,
        api_version=config.api_version,
        deployment=config.tts_deployment,
        voice=voice or config.tts_voice,
    )


async def build_realtime_caller(
    db: AsyncSession,
    connection_id: uuid.UUID,
    *,
    secret_box: SecretBox,
    allow_local_http: bool = False,
    voice: str | None = None,
) -> RealtimeCaller:
    """The realtime evaluator for the stored connection `connection_id` (not connected yet).

    `voice` overrides the connection's voice; a voice the realtime model lacks becomes its
    default. Raises `ConnectionNotFound`, `UnsupportedConnection` for kinds without a realtime
    model (and Azure OpenAI without a realtime deployment), and `SecretDecryptionError`.
    """
    record = await db.get(ConnectionRecord, connection_id, populate_existing=True)
    if record is None:
        raise ConnectionNotFound(str(connection_id))
    kind = ConnectionKind(record.kind)
    if kind not in (ConnectionKind.OPENAI, ConnectionKind.AZURE_OPENAI):
        raise UnsupportedConnection(f"{kind.value} connections have no realtime model")
    config = parse_config(kind, record.config, allow_local_http=allow_local_http)
    if kind is ConnectionKind.AZURE_OPENAI and config.realtime_deployment is None:
        raise UnsupportedConnection(
            "this azure_openai connection has no realtime deployment: set one to use the "
            "realtime evaluator"
        )
    secrets = reveal(open_secrets(secret_box, record))
    chosen = realtime_voice(voice or config.tts_voice)
    if kind is ConnectionKind.OPENAI:
        return build_openai_realtime_caller(
            api_key=secrets["api_key"],
            model=config.realtime_model,
            voice=chosen,
            base_url=config.base_url,
        )
    return build_azure_openai_realtime_caller(
        api_key=secrets["api_key"],
        endpoint=config.endpoint,
        deployment=config.realtime_deployment,
        voice=chosen,
    )


async def _chat_settings(
    db: AsyncSession,
    connection_id: uuid.UUID,
    *,
    secret_box: SecretBox,
    allow_local_http: bool,
    role: str,
) -> tuple[ConnectionKind, Any, dict[str, str]]:
    """The kind, config and revealed secrets of a chat-capable connection (`role` names the use)."""
    record = await db.get(ConnectionRecord, connection_id, populate_existing=True)
    if record is None:
        raise ConnectionNotFound(str(connection_id))
    kind = ConnectionKind(record.kind)
    if kind not in (ConnectionKind.OPENAI, ConnectionKind.AZURE_OPENAI):
        raise UnsupportedConnection(f"{kind.value} connections cannot act as the {role}")
    config = parse_config(kind, record.config, allow_local_http=allow_local_http)
    if kind is ConnectionKind.AZURE_OPENAI and config.chat_deployment is None:
        raise UnsupportedConnection(
            f"this azure_openai connection has no chat deployment: set one to use it as the {role}"
        )
    return kind, config, reveal(open_secrets(secret_box, record))


async def build_caller_policy(
    db: AsyncSession,
    connection_id: uuid.UUID,
    *,
    secret_box: SecretBox,
    allow_local_http: bool = False,
) -> CallerPolicy:
    """The evaluator's chat policy for the stored connection `connection_id`.

    Raises `ConnectionNotFound`, `UnsupportedConnection` when the connection has no chat model
    (other kinds, or Azure OpenAI without a chat deployment), and `SecretDecryptionError`.
    """
    kind, config, secrets = await _chat_settings(
        db,
        connection_id,
        secret_box=secret_box,
        allow_local_http=allow_local_http,
        role="evaluator",
    )
    if kind is ConnectionKind.OPENAI:
        return build_openai_policy(
            api_key=secrets["api_key"], model=config.chat_model, base_url=config.base_url
        )
    return build_azure_openai_policy(
        api_key=secrets["api_key"],
        endpoint=config.endpoint,
        api_version=config.api_version,
        deployment=config.chat_deployment,
    )


async def build_judge(
    db: AsyncSession,
    connection_id: uuid.UUID,
    *,
    secret_box: SecretBox,
    allow_local_http: bool = False,
) -> RunJudgeModel:
    """The run judge's model (the same gpt-6-luna chat model as the evaluator) for `connection_id`.

    Raises `ConnectionNotFound`, `UnsupportedConnection` when the connection has no chat model,
    and `SecretDecryptionError`.
    """
    kind, config, secrets = await _chat_settings(
        db, connection_id, secret_box=secret_box, allow_local_http=allow_local_http, role="judge"
    )
    if kind is ConnectionKind.OPENAI:
        return build_openai_judge(
            api_key=secrets["api_key"], model=config.chat_model, base_url=config.base_url
        )
    return build_azure_openai_judge(
        api_key=secrets["api_key"],
        endpoint=config.endpoint,
        api_version=config.api_version,
        deployment=config.chat_deployment,
    )


async def build_trace_reader(
    db: AsyncSession,
    connection_id: uuid.UUID,
    *,
    secret_box: SecretBox,
    allow_local_http: bool = False,
    allow_private: bool = False,
) -> "LangfuseTraceReader":
    """A Langfuse trace reader for the stored connection `connection_id`.

    `allow_private` lifts the egress guard (development only, for a local Langfuse).
    Raises `ConnectionNotFound`, `UnsupportedConnection` for kinds other than Langfuse, and
    `SecretDecryptionError`.
    """
    record = await db.get(ConnectionRecord, connection_id, populate_existing=True)
    if record is None:
        raise ConnectionNotFound(str(connection_id))
    kind = ConnectionKind(record.kind)
    if kind is not ConnectionKind.LANGFUSE:
        raise UnsupportedConnection(f"{kind.value} connections cannot read traces")
    config = parse_config(kind, record.config, allow_local_http=allow_local_http)
    secrets = reveal(open_secrets(secret_box, record))
    return build_langfuse_trace_reader(
        host=config.host,
        public_key=config.public_key,
        secret_key=secrets["secret_key"],
        allow_private=allow_private,
    )
