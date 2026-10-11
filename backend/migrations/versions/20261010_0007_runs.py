"""run batches and runs

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUN_STATUSES = (
    "'queued', 'connecting', 'running', 'completed', 'failed', 'cancelled', 'interrupted'"
)
BATCH_STATUSES = "'queued', 'running', 'completed', 'cancelled'"


def upgrade() -> None:
    op.create_table(
        "run_batches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.Column("concurrency", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("total_runs", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "concurrency BETWEEN 1 AND 10", name=op.f("ck_run_batches_concurrency_range")
        ),
        sa.CheckConstraint(
            f"status IN ({BATCH_STATUSES})", name=op.f("ck_run_batches_status_known")
        ),
        sa.CheckConstraint("total_runs > 0", name=op.f("ck_run_batches_total_runs_positive")),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_run_batches_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_run_batches")),
    )
    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("scenario_id", sa.Uuid(), nullable=True),
        sa.Column("agent_id", sa.Uuid(), nullable=True),
        sa.Column("thread_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("end_reason", sa.String(length=64), nullable=True),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("artifacts_dir", sa.String(length=1024), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(f"status IN ({RUN_STATUSES})", name=op.f("ck_runs_status_known")),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["run_batches.id"],
            name=op.f("fk_runs_batch_id_run_batches"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["scenario_id"],
            ["scenarios.id"],
            name=op.f("fk_runs_scenario_id_scenarios"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            ["agents.id"],
            name=op.f("fk_runs_agent_id_agents"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_runs")),
    )
    op.create_index(op.f("ix_runs_batch_id"), "runs", ["batch_id"])
    op.create_index(op.f("ix_runs_scenario_id"), "runs", ["scenario_id"])
    op.create_index("ix_runs_created_at", "runs", ["created_at"])
    op.create_index("ix_runs_status", "runs", ["status"])


def downgrade() -> None:
    op.drop_table("runs")
    op.drop_table("run_batches")
