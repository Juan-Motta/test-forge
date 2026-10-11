"""Persistence model for run judgements: one row per run, removed with the run."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from voice_eval.modules.judgements.domain import Judgement, JudgementStatus
from voice_eval.platform.db import Base

JUDGEMENT_STATUSES_SQL = ", ".join(f"'{status.value}'" for status in JudgementStatus)


class RunJudgementRecord(Base):
    __tablename__ = "run_judgements"
    __table_args__ = (
        CheckConstraint(f"status IN ({JUDGEMENT_STATUSES_SQL})", name="status_known"),
    )

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(24))
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    trace_stats: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    trace_note: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(Text)
    attempt: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def to_domain(self) -> Judgement:
        return Judgement(
            run_id=self.run_id,
            status=JudgementStatus(self.status),
            result=self.result,
            trace_stats=self.trace_stats,
            trace_note=self.trace_note,
            error=self.error,
            model=self.model,
            attempt=self.attempt,
            created_at=self.created_at,
            updated_at=self.updated_at,
            completed_at=self.completed_at,
        )
