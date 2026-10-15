"""HTTP API of the pricing module: `/api/pricing` (behind authentication).

`GET` returns the model price table (USD per 1M tokens, per usage bucket) with its source and
as-of date; `PUT` replaces it (non-negative numbers; a model left out is removed). The cost of
each run is computed from these prices (`domain.run_cost`) and served on the runs.
"""

from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.pricing import service
from voice_eval.modules.pricing.domain import (
    APPROXIMATE_NOTE,
    PRICES_AS_OF,
    PRICING_SOURCE,
    ModelPrice,
    PriceList,
    PricingModel,
)
from voice_eval.platform.db import get_db_session

Db = Annotated[AsyncSession, Depends(get_db_session)]


class PricingOut(PricingModel):
    currency: str = "USD"
    unit: str = "per 1M tokens"
    source: str = PRICING_SOURCE
    as_of: date = PRICES_AS_OF  # when the seeded list prices were checked
    note: str = APPROXIMATE_NOTE
    updated_at: datetime | None  # the last time the table changed (seeded or edited)
    items: list[ModelPrice]


router = APIRouter(prefix="/pricing", tags=["pricing"])


async def _out(db: AsyncSession) -> PricingOut:
    return PricingOut(
        items=await service.list_prices(db), updated_at=await service.last_updated(db)
    )


@router.get("", response_model=PricingOut, response_model_by_alias=True)
async def get_pricing(db: Db) -> PricingOut:
    """The model price table the run costs are computed with."""
    return await _out(db)


@router.put("", response_model=PricingOut, response_model_by_alias=True)
async def put_pricing(body: PriceList, db: Db) -> PricingOut:
    """Replace the price table. 422 for a negative or non-numeric price or a repeated model."""
    await service.replace_prices(db, body.items)
    return await _out(db)
