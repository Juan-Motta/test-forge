"""Persistence of APIs, their flows and the agents a flow is meant for. Steps are JSON."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from voice_eval.modules.agents.models import AgentRecord
from voice_eval.modules.apiflows.domain import MAX_NAME_LENGTH, MAX_TAG_LENGTH
from voice_eval.platform.db import Base

API_NAME_UNIQUE_CONSTRAINT = "uq_apis_name"
FLOW_NAME_UNIQUE_CONSTRAINT = "uq_api_flows_api_id_name"

flow_agents = Table(
    "api_flow_agents",
    Base.metadata,
    Column("flow_id", ForeignKey("api_flows.id", ondelete="CASCADE"), primary_key=True),
    Column("agent_id", ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True, index=True),
)


class ApiRecord(Base):
    __tablename__ = "apis"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        UniqueConstraint("name", name=API_NAME_UNIQUE_CONSTRAINT),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(MAX_NAME_LENGTH))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(String(MAX_TAG_LENGTH)), default=list, server_default=text("'{}'::varchar[]")
    )
    base_url: Mapped[str] = mapped_column(String(2048))
    # Plain (not secret) headers every step sends: [{"name", "value"}].
    headers: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    # All secrets sealed together (owner: this API); hints are shown instead of the values.
    secrets_ciphertext: Mapped[str | None] = mapped_column(Text)
    secret_hints: Mapped[dict[str, str]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FlowRecord(Base):
    __tablename__ = "api_flows"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        UniqueConstraint("api_id", "name", name=FLOW_NAME_UNIQUE_CONSTRAINT),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    api_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("apis.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(MAX_NAME_LENGTH))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    inputs: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    api: Mapped[ApiRecord] = relationship(lazy="joined", innerjoin=True)
    agents: Mapped[list[AgentRecord]] = relationship(
        secondary=flow_agents, lazy="selectin", order_by=AgentRecord.name
    )
