"""Persistence model for provider connections. Secrets live only as ciphertext."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from voice_eval.modules.connections.domain import (
    MAX_NAME_LENGTH,
    MAX_TEST_DETAIL_LENGTH,
    Connection,
    ConnectionKind,
    LastTest,
)
from voice_eval.platform.db import Base

KINDS_SQL = ", ".join(f"'{kind.value}'" for kind in ConnectionKind)


class ConnectionRecord(Base):
    __tablename__ = "provider_connections"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint(f"kind IN ({KINDS_SQL})", name="kind_known"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(MAX_NAME_LENGTH), unique=True)
    kind: Mapped[str] = mapped_column(String(32))
    config: Mapped[dict[str, Any]] = mapped_column(JSONB)
    secret_ciphertext: Mapped[str] = mapped_column(Text)
    secret_hint: Mapped[str] = mapped_column(String(16))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_test_ok: Mapped[bool | None]
    last_test_detail: Mapped[str | None] = mapped_column(String(MAX_TEST_DETAIL_LENGTH))

    def to_domain(self) -> Connection:
        last_test = None
        if self.last_tested_at is not None and self.last_test_ok is not None:
            last_test = LastTest(
                at=self.last_tested_at, ok=self.last_test_ok, detail=self.last_test_detail or ""
            )
        return Connection(
            id=self.id,
            name=self.name,
            kind=ConnectionKind(self.kind),
            config=dict(self.config),
            secret_hint=self.secret_hint,
            has_secret=bool(self.secret_ciphertext),
            last_test=last_test,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )
