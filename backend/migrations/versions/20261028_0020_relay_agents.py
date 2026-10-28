"""relay agents: a third voice protocol, without channel or user, that may create its sessions

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Literals on purpose: a migration describes the schema at this revision, not today's enums.
OLD = {
    "protocol_known": "protocol IN ('auto', 'live', 'realtime')",
    "kind_config": (
        "(kind = 'voice' AND user_id IS NOT NULL AND text_mode IS NULL AND auth IS NULL) OR "
        "(kind = 'text' AND user_id IS NULL AND text_mode IS NOT NULL AND auth IS NOT NULL)"
    ),
}
NEW = {
    "protocol_known": "protocol IN ('auto', 'live', 'realtime', 'relay')",
    "kind_config": (
        "(kind = 'voice' AND (user_id IS NOT NULL OR protocol = 'relay') AND text_mode IS NULL "
        "AND auth IS NULL) OR "
        "(kind = 'text' AND user_id IS NULL AND text_mode IS NOT NULL AND auth IS NOT NULL)"
    ),
    "session_url_relay_only": "session_url IS NULL OR protocol = 'relay'",
}


def _replace(drop: dict[str, str], create: dict[str, str]) -> None:
    for name in drop:
        op.drop_constraint(op.f(f"ck_agents_{name}"), "agents", type_="check")
    for name, condition in create.items():
        op.create_check_constraint(op.f(f"ck_agents_{name}"), "agents", condition)


def upgrade() -> None:
    op.add_column("agents", sa.Column("session_url", sa.String(length=2048), nullable=True))
    _replace(OLD, NEW)


def downgrade() -> None:
    # Refused while relay agents exist: they have no place in the old schema.
    _replace(NEW, OLD)
    op.drop_column("agents", "session_url")
