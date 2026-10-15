"""usage and model prices

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Literals on purpose: OpenAI list prices (standard tier, USD per 1M tokens) as published at
# https://developers.openai.com/api/docs/pricing on 2026-10-15, not today's seed in code.
BUCKETS = ("text_in", "cached_text_in", "audio_in", "cached_audio_in", "text_out", "audio_out")
SEED = [
    {"model": "gpt-6-luna", "text_in": 0.10, "cached_text_in": 0.01, "text_out": 0.50},
    {
        "model": "gpt-realtime-2.1",
        "text_in": 4.00,
        "cached_text_in": 0.40,
        "audio_in": 32.00,
        "cached_audio_in": 0.40,
        "text_out": 24.00,
        "audio_out": 64.00,
    },
    {
        "model": "gpt-realtime-2.1-mini",
        "text_in": 0.60,
        "cached_text_in": 0.06,
        "audio_in": 10.00,
        "cached_audio_in": 0.30,
        "text_out": 2.40,
        "audio_out": 20.00,
    },
    {"model": "gpt-4o-mini-tts", "text_in": 0.60, "audio_out": 12.00},
]


def upgrade() -> None:
    # the judge's usage summed over every judgement attempt of the run (re-judges included)
    op.add_column(
        "run_judgements",
        sa.Column("usage", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    table = op.create_table(
        "model_prices",
        sa.Column("model", sa.String(length=100), nullable=False),
        *(sa.Column(bucket, sa.Numeric(12, 4), nullable=True) for bucket in BUCKETS),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("model", name=op.f("pk_model_prices")),
    )
    op.bulk_insert(table, [{bucket: None for bucket in BUCKETS} | row for row in SEED])


def downgrade() -> None:
    op.drop_table("model_prices")
    op.drop_column("run_judgements", "usage")
