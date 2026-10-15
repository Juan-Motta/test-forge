"""Persistence model for model prices: one row per model, USD per 1M tokens per bucket."""

from datetime import datetime

from sqlalchemy import DateTime, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from voice_eval.modules.pricing.domain import ModelPrice
from voice_eval.platform.db import Base

PRICE_TYPE = Numeric(12, 4)


class ModelPriceRecord(Base):
    __tablename__ = "model_prices"

    model: Mapped[str] = mapped_column(String(100), primary_key=True)
    text_in: Mapped[float | None] = mapped_column(PRICE_TYPE)
    cached_text_in: Mapped[float | None] = mapped_column(PRICE_TYPE)
    audio_in: Mapped[float | None] = mapped_column(PRICE_TYPE)
    cached_audio_in: Mapped[float | None] = mapped_column(PRICE_TYPE)
    text_out: Mapped[float | None] = mapped_column(PRICE_TYPE)
    audio_out: Mapped[float | None] = mapped_column(PRICE_TYPE)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def to_domain(self) -> ModelPrice:
        def number(value: object) -> float | None:
            return None if value is None else float(value)  # Decimal from the database

        return ModelPrice(
            model=self.model,
            text_in=number(self.text_in),
            cached_text_in=number(self.cached_text_in),
            audio_in=number(self.audio_in),
            cached_audio_in=number(self.cached_audio_in),
            text_out=number(self.text_out),
            audio_out=number(self.audio_out),
        )
