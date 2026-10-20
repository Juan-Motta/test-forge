"""api flows: APIs with sealed secrets, their flows and the agents a flow is meant for

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "apis",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.String(length=40)),
            server_default=sa.text("'{}'::varchar[]"),
            nullable=False,
        ),
        sa.Column("base_url", sa.String(length=2048), nullable=False),
        sa.Column(
            "headers",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("secrets_ciphertext", sa.Text(), nullable=True),
        sa.Column(
            "secret_hints",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint("length(btrim(name)) > 0", name=op.f("ck_apis_name_not_blank")),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_apis_created_by_users"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_apis")),
        sa.UniqueConstraint("name", name=op.f("uq_apis_name")),
    )
    op.create_table(
        "api_flows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("api_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("inputs", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("steps", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint("length(btrim(name)) > 0", name=op.f("ck_api_flows_name_not_blank")),
        sa.ForeignKeyConstraint(
            ["api_id"], ["apis.id"], name=op.f("fk_api_flows_api_id_apis"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_api_flows_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_api_flows")),
        sa.UniqueConstraint("api_id", "name", name=op.f("uq_api_flows_api_id_name")),
    )
    op.create_index(op.f("ix_api_flows_api_id"), "api_flows", ["api_id"])
    op.create_table(
        "api_flow_agents",
        sa.Column("flow_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            ["agents.id"],
            name=op.f("fk_api_flow_agents_agent_id_agents"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["flow_id"],
            ["api_flows.id"],
            name=op.f("fk_api_flow_agents_flow_id_api_flows"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("flow_id", "agent_id", name=op.f("pk_api_flow_agents")),
    )
    op.create_index(op.f("ix_api_flow_agents_agent_id"), "api_flow_agents", ["agent_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_api_flow_agents_agent_id"), table_name="api_flow_agents")
    op.drop_table("api_flow_agents")
    op.drop_index(op.f("ix_api_flows_api_id"), table_name="api_flows")
    op.drop_table("api_flows")
    op.drop_table("apis")
