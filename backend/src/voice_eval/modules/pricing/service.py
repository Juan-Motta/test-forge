"""Pricing use cases over the database: read the price table, replace it."""

from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.pricing.domain import ModelPrice
from voice_eval.modules.pricing.models import ModelPriceRecord
from voice_eval.ports.usage import BUCKETS


async def list_prices(db: AsyncSession) -> list[ModelPrice]:
    """Every model's prices, by model name."""
    records = await db.scalars(select(ModelPriceRecord).order_by(ModelPriceRecord.model))
    return [record.to_domain() for record in records]


async def last_updated(db: AsyncSession) -> datetime | None:
    return await db.scalar(select(func.max(ModelPriceRecord.updated_at)))


async def replace_prices(db: AsyncSession, items: list[ModelPrice]) -> list[ModelPrice]:
    """The table becomes exactly `items` (models left out are removed), in one transaction."""
    now = datetime.now(UTC)
    await db.execute(delete(ModelPriceRecord))
    db.add_all(
        ModelPriceRecord(
            model=item.model, updated_at=now, **{bucket: item.of(bucket) for bucket in BUCKETS}
        )
        for item in items
    )
    await db.commit()
    return await list_prices(db)
