"""scenario evaluator model connection

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("scenarios", sa.Column("evaluator_connection_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_scenarios_evaluator_connection_id_provider_connections"),
        "scenarios",
        "provider_connections",
        ["evaluator_connection_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_scenarios_evaluator_connection_id_provider_connections"),
        "scenarios",
        type_="foreignkey",
    )
    op.drop_column("scenarios", "evaluator_connection_id")
