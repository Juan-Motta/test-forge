"""Persistence model for the voice agents under test."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from voice_eval.modules.agents.domain import (
    MAX_CHANNEL_ID_LENGTH,
    MAX_NAME_LENGTH,
    MAX_ORIGIN_LENGTH,
    MAX_URL_LENGTH,
    MAX_USER_ID_LENGTH,
    Agent,
    AgentProtocol,
)
from voice_eval.platform.db import Base

PROTOCOLS_SQL = ", ".join(f"'{protocol.value}'" for protocol in AgentProtocol)
NAME_UNIQUE_CONSTRAINT = "uq_agents_name"  # from the metadata naming convention


class AgentRecord(Base):
    __tablename__ = "agents"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint(f"protocol IN ({PROTOCOLS_SQL})", name="protocol_known"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(MAX_NAME_LENGTH), unique=True)
    context: Mapped[str] = mapped_column(Text)
    protocol: Mapped[str] = mapped_column(String(16))
    base_url: Mapped[str] = mapped_column(String(MAX_URL_LENGTH))
    channel_id: Mapped[str] = mapped_column(String(MAX_CHANNEL_ID_LENGTH))
    user_id: Mapped[str] = mapped_column(String(MAX_USER_ID_LENGTH))
    origin: Mapped[str | None] = mapped_column(String(MAX_ORIGIN_LENGTH))
    langfuse_connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("provider_connections.id", ondelete="SET NULL")
    )
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
        )
