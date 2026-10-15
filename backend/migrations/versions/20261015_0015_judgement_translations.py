"""judgement translations

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # {language: {"status": "pending" | "ready" | "failed", "error": str | None, "fields": {...}}}
    op.add_column(
        "run_judgements",
        sa.Column("translations", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("run_judgements", "translations")
