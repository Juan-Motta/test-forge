"""agents under test

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("context", sa.Text(), nullable=False),
        sa.Column("protocol", sa.String(length=16), nullable=False),
        sa.Column("base_url", sa.String(length=2048), nullable=False),
        sa.Column("channel_id", sa.String(length=200), nullable=False),
        sa.Column("user_id", sa.String(length=200), nullable=False),
        sa.Column("origin", sa.String(length=300), nullable=True),
        sa.Column("langfuse_connection_id", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("length(btrim(name)) > 0", name=op.f("ck_agents_name_not_blank")),
        sa.CheckConstraint(
            "protocol IN ('auto', 'live', 'realtime')", name=op.f("ck_agents_protocol_known")
        ),
        sa.ForeignKeyConstraint(
            ["langfuse_connection_id"],
            ["provider_connections.id"],
            name=op.f("fk_agents_langfuse_connection_id_provider_connections"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_agents_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agents")),
        sa.UniqueConstraint("name", name=op.f("uq_agents_name")),
    )


def downgrade() -> None:
    op.drop_table("agents")
