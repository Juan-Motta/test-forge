"""scenario groups: every scenario lives in exactly one group

Existing scenarios move into one group per agent, named after the agent (agent names are unique
and at most 120 characters, within the group's 160), so nothing is left without a group.

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scenario_groups",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.String(length=40)),
            server_default=sa.text("'{}'::varchar[]"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "length(btrim(name)) > 0", name=op.f("ck_scenario_groups_name_not_blank")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_scenario_groups_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scenario_groups")),
        sa.UniqueConstraint("name", name=op.f("uq_scenario_groups_name")),
    )

    op.add_column("scenarios", sa.Column("group_id", sa.Uuid(), nullable=True))
    # One group per agent that has scenarios, then every scenario into its agent's group.
    op.execute(
        """
        INSERT INTO scenario_groups (id, name)
        SELECT gen_random_uuid(), agents.name
        FROM agents
        WHERE EXISTS (SELECT 1 FROM scenarios WHERE scenarios.agent_id = agents.id)
        """
    )
    op.execute(
        """
        UPDATE scenarios
        SET group_id = scenario_groups.id
        FROM agents
        JOIN scenario_groups ON scenario_groups.name = agents.name
        WHERE scenarios.agent_id = agents.id
        """
    )
    op.alter_column("scenarios", "group_id", existing_type=sa.Uuid(), nullable=False)
    op.create_foreign_key(
        op.f("fk_scenarios_group_id_scenario_groups"),
        "scenarios",
        "scenario_groups",
        ["group_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(op.f("ix_scenarios_group_id"), "scenarios", ["group_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_scenarios_group_id"), table_name="scenarios")
    op.drop_constraint(
        op.f("fk_scenarios_group_id_scenario_groups"), "scenarios", type_="foreignkey"
    )
    op.drop_column("scenarios", "group_id")
    op.drop_table("scenario_groups")
