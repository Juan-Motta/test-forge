"""evaluation scenarios

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scenarios",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("tags", postgresql.ARRAY(sa.String(length=40)), nullable=False),
        sa.Column("context", sa.Text(), nullable=False),
        sa.Column("persona", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("tts_connection_id", sa.Uuid(), nullable=True),
        sa.Column("voice_override", sa.String(length=100), nullable=True),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("facts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("criteria", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("end_conditions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("length(btrim(name)) > 0", name=op.f("ck_scenarios_name_not_blank")),
        sa.CheckConstraint("length(btrim(goal)) > 0", name=op.f("ck_scenarios_goal_not_blank")),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            ["agents.id"],
            name=op.f("fk_scenarios_agent_id_agents"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tts_connection_id"],
            ["provider_connections.id"],
            name=op.f("fk_scenarios_tts_connection_id_provider_connections"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_scenarios_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scenarios")),
        sa.UniqueConstraint("agent_id", "name", name=op.f("uq_scenarios_agent_id_name")),
    )


def downgrade() -> None:
    op.drop_table("scenarios")
