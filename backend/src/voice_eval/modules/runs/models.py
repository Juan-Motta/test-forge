"""Persistence model for run batches and runs. The snapshot and summary are JSON (snake_case)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from voice_eval.modules.runs.domain import (
    MAX_BATCH_CONCURRENCY,
    MAX_ERROR_LENGTH,
    MAX_LABEL_LENGTH,
    BatchStatus,
    Run,
    RunStatus,
)
from voice_eval.platform.db import Base

RUN_STATUSES_SQL = ", ".join(f"'{status.value}'" for status in RunStatus)
BATCH_STATUSES_SQL = ", ".join(f"'{status.value}'" for status in BatchStatus)


class RunBatchRecord(Base):
    __tablename__ = "run_batches"
    __table_args__ = (
        CheckConstraint(
            f"concurrency BETWEEN 1 AND {MAX_BATCH_CONCURRENCY}", name="concurrency_range"
        ),
        CheckConstraint(f"status IN ({BATCH_STATUSES_SQL})", name="status_known"),
        CheckConstraint("total_runs > 0", name="total_runs_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    label: Mapped[str | None] = mapped_column(String(MAX_LABEL_LENGTH))
    concurrency: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16))
    total_runs: Mapped[int] = mapped_column(Integer)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RunRecord(Base):
    __tablename__ = "runs"
    __table_args__ = (
        CheckConstraint(f"status IN ({RUN_STATUSES_SQL})", name="status_known"),
        Index("ix_runs_created_at", "created_at"),
        Index("ix_runs_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("run_batches.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    scenario_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("scenarios.id", ondelete="SET NULL"), index=True
    )
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    thread_id: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    end_reason: Mapped[str | None] = mapped_column(String(64))
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    artifacts_dir: Mapped[str | None] = mapped_column(String(1024))
    error: Mapped[str | None] = mapped_column(String(MAX_ERROR_LENGTH))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def to_domain(self) -> Run:
        return Run(
            id=self.id,
            batch_id=self.batch_id,
            position=self.position,
            scenario_id=self.scenario_id,
            agent_id=self.agent_id,
            thread_id=self.thread_id,
            status=RunStatus(self.status),
            end_reason=self.end_reason,
            created_at=self.created_at,
            started_at=self.started_at,
            ended_at=self.ended_at,
            summary=self.summary,
            artifacts_dir=self.artifacts_dir,
            error=self.error,
            snapshot=self.snapshot,
        )
