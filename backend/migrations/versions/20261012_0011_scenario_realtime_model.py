"""scenario realtime model

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "scenarios",
        sa.Column(
            "realtime_model",
            sa.String(length=40),
            server_default="gpt-realtime-2.1-mini",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("scenarios", "realtime_model")
