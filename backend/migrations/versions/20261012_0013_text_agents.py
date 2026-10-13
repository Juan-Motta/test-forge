"""text agents

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Literals on purpose: a migration describes the schema at this revision, not today's enums.
KIND_CONFIG = (
    "(kind = 'voice' AND user_id IS NOT NULL AND text_mode IS NULL AND auth IS NULL) OR "
    "(kind = 'text' AND user_id IS NULL AND text_mode IS NOT NULL AND auth IS NOT NULL)"
)
CHECKS = {
    "kind_known": "kind IN ('voice', 'text')",
    "text_mode_known": "text_mode IN ('invoke', 'stream')",
    "auth_known": "auth IN ('none', 'api_key')",
    "kind_config": KIND_CONFIG,
    "api_key_matches_auth": "(coalesce(auth, 'none') = 'api_key') = (auth_ciphertext IS NOT NULL)",
}


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("kind", sa.String(length=16), server_default="voice", nullable=False),
    )
    op.add_column("agents", sa.Column("text_mode", sa.String(length=16), nullable=True))
    op.add_column("agents", sa.Column("auth", sa.String(length=16), nullable=True))
    op.add_column("agents", sa.Column("auth_ciphertext", sa.Text(), nullable=True))
    op.add_column("agents", sa.Column("auth_hint", sa.String(length=16), nullable=True))
    op.alter_column("agents", "user_id", existing_type=sa.String(length=200), nullable=True)
    for name, condition in CHECKS.items():
        op.create_check_constraint(op.f(f"ck_agents_{name}"), "agents", condition)


def downgrade() -> None:
    # Refused (user_id NOT NULL) while text agents exist: they have no place in the old schema.
    for name in reversed(CHECKS):
        op.drop_constraint(op.f(f"ck_agents_{name}"), "agents", type_="check")
    op.alter_column("agents", "user_id", existing_type=sa.String(length=200), nullable=False)
    op.drop_column("agents", "auth_hint")
    op.drop_column("agents", "auth_ciphertext")
    op.drop_column("agents", "auth")
    op.drop_column("agents", "text_mode")
    op.drop_column("agents", "kind")
