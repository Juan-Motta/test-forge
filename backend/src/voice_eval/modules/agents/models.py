"""Persistence model for the agents under test (voice and text)."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from voice_eval.modules.agents.domain import (
    MAX_CHANNEL_ID_LENGTH,
    MAX_NAME_LENGTH,
    MAX_ORIGIN_LENGTH,
    MAX_URL_LENGTH,
    MAX_USER_ID_LENGTH,
    Agent,
    AgentKind,
    AgentProtocol,
    TextAuth,
    TextMode,
)
from voice_eval.platform.db import Base


def _sql_values(enum: type[StrEnum]) -> str:
    return ", ".join(f"'{member.value}'" for member in enum)


PROTOCOLS_SQL = _sql_values(AgentProtocol)
KINDS_SQL = _sql_values(AgentKind)
TEXT_MODES_SQL = _sql_values(TextMode)
TEXT_AUTHS_SQL = _sql_values(TextAuth)
# Each kind has exactly its own settings; a sealed API key exists exactly when auth is api_key.
KIND_CONFIG_SQL = (
    "(kind = 'voice' AND user_id IS NOT NULL AND text_mode IS NULL AND auth IS NULL) OR "
    "(kind = 'text' AND user_id IS NULL AND text_mode IS NOT NULL AND auth IS NOT NULL)"
)
API_KEY_SQL = "(coalesce(auth, 'none') = 'api_key') = (auth_ciphertext IS NOT NULL)"
NAME_UNIQUE_CONSTRAINT = "uq_agents_name"  # from the metadata naming convention


class AgentRecord(Base):
    __tablename__ = "agents"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint(f"protocol IN ({PROTOCOLS_SQL})", name="protocol_known"),
        CheckConstraint(f"kind IN ({KINDS_SQL})", name="kind_known"),
        CheckConstraint(f"text_mode IN ({TEXT_MODES_SQL})", name="text_mode_known"),
        CheckConstraint(f"auth IN ({TEXT_AUTHS_SQL})", name="auth_known"),
        CheckConstraint(KIND_CONFIG_SQL, name="kind_config"),
        CheckConstraint(API_KEY_SQL, name="api_key_matches_auth"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(MAX_NAME_LENGTH), unique=True)
    context: Mapped[str] = mapped_column(Text)
    protocol: Mapped[str] = mapped_column(String(16))
    base_url: Mapped[str] = mapped_column(String(MAX_URL_LENGTH))
    channel_id: Mapped[str] = mapped_column(String(MAX_CHANNEL_ID_LENGTH))
    user_id: Mapped[str | None] = mapped_column(String(MAX_USER_ID_LENGTH))
    origin: Mapped[str | None] = mapped_column(String(MAX_ORIGIN_LENGTH))
    langfuse_connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("provider_connections.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(
        String(16), default=AgentKind.VOICE.value, server_default=AgentKind.VOICE.value
    )
    text_mode: Mapped[str | None] = mapped_column(String(16))
    auth: Mapped[str | None] = mapped_column(String(16))
    auth_ciphertext: Mapped[str | None] = mapped_column(Text)  # SecretBox token, never returned
    auth_hint: Mapped[str | None] = mapped_column(String(16))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def to_domain(self) -> Agent:
        return Agent(
            id=self.id,
            name=self.name,
            context=self.context,
            protocol=AgentProtocol(self.protocol),
            base_url=self.base_url,
            channel_id=self.channel_id,
            user_id=self.user_id,
            origin=self.origin,
            langfuse_connection_id=self.langfuse_connection_id,
            created_at=self.created_at,
            updated_at=self.updated_at,
            kind=AgentKind(self.kind),
            text_mode=TextMode(self.text_mode) if self.text_mode else None,
            auth=TextAuth(self.auth) if self.auth else None,
            has_api_key=self.auth_ciphertext is not None,
            api_key_hint=self.auth_hint if self.auth_ciphertext is not None else None,
        )
