"""Pricing domain: per-model token prices and the cost of the evaluator's usage.

Prices are USD per 1M tokens, one per usage bucket (`ports.usage.BUCKETS`); None means the
model has no such price (e.g. no audio for gpt-6-luna). They are seeded with OpenAI's
published list prices (standard tier, `PRICING_SOURCE` as of `PRICES_AS_OF`) and editable.
Azure OpenAI does not publish prices for these models, so every cost is approximate.

`run_cost` turns a run's caller usage (its summary) and judge usage (every judgement attempt)
into dollars. A cost is incomplete when some tokens have no price, or when the usage could not
be fully metered (TTS audio output: the speech endpoint reports no usage).
"""

import math
from dataclasses import dataclass, field
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)
from pydantic.alias_generators import to_camel

from voice_eval.ports.usage import BUCKETS, TTS_AUDIO_NOT_METERED, TTS_TEXT_ESTIMATED

PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing"
PRICES_AS_OF = date(2026, 10, 15)
PRICE_UNIT_TOKENS = 1_000_000
MAX_PRICE = 100_000.0  # USD per 1M tokens; anything above is a typo
MAX_MODELS = 50
APPROXIMATE_NOTE = (
    "Approximate: OpenAI list prices (standard tier, USD per 1M tokens). Azure OpenAI prices "
    "are not published for these models and may differ. Reasoning tokens are billed as output."
)
USAGE_NOTES = {
    TTS_AUDIO_NOT_METERED: "TTS audio not priced: the speech endpoint reports no usage",
    TTS_TEXT_ESTIMATED: "TTS input tokens are estimated (4 characters a token)",
}
INCOMPLETE_NOTES = frozenset({TTS_AUDIO_NOT_METERED})

Part = Literal["caller", "judge"]
ModelName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._:-]+$"
    ),
]
PRICE_DECIMALS = 4  # the column is Numeric(12, 4): more decimals would be rounded silently


def _check_decimals(value: float) -> float:
    if round(value, PRICE_DECIMALS) != value:
        raise ValueError(f"use at most {PRICE_DECIMALS} decimals")
    return value


Price = (
    Annotated[
        float,
        Field(ge=0, le=MAX_PRICE, allow_inf_nan=False),
        AfterValidator(_check_decimals),
    ]
    | None
)


class PricingModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        hide_input_in_errors=True,
    )


class ModelPrice(PricingModel):
    """USD per 1M tokens of each bucket; None: the model has no price for it."""

    model: ModelName
    text_in: Price = None
    cached_text_in: Price = None
    audio_in: Price = None
    cached_audio_in: Price = None
    text_out: Price = None
    audio_out: Price = None

    def of(self, bucket: str) -> float | None:
        return getattr(self, bucket)


class PriceList(PricingModel):
    items: list[ModelPrice] = Field(max_length=MAX_MODELS)

    @model_validator(mode="after")
    def unique_models(self) -> "PriceList":
        names = [item.model for item in self.items]
        if len(names) != len(set(names)):
            raise ValueError("each model may appear only once")
        return self


SEED_PRICES = (
    ModelPrice(model="gpt-6-luna", text_in=0.10, cached_text_in=0.01, text_out=0.50),
    ModelPrice(
        model="gpt-realtime-2.1",
        text_in=4.00,
        cached_text_in=0.40,
        audio_in=32.00,
        cached_audio_in=0.40,
        text_out=24.00,
        audio_out=64.00,
    ),
    ModelPrice(
        model="gpt-realtime-2.1-mini",
        text_in=0.60,
        cached_text_in=0.06,
        audio_in=10.00,
        cached_audio_in=0.30,
        text_out=2.40,
        audio_out=20.00,
    ),
    ModelPrice(model="gpt-4o-mini-tts", text_in=0.60, audio_out=12.00),
)


@dataclass(frozen=True)
class CostLine:
    part: Part
    model: str
    usd: float | None  # None: some of its tokens have no price


@dataclass(frozen=True)
class RunCost:
    caller_usd: float | None  # None: no caller usage recorded (runs before usage capture)
    judge_usd: float | None  # None: no judge usage recorded yet
    total_usd: float
    complete: bool
    notes: list[str] = field(default_factory=list)
    breakdown: list[CostLine] = field(default_factory=list)


def _usd(value: float) -> float:
    return round(value, 6)


def _tokens(value: Any) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return 0


@dataclass
class _PartCost:
    usd: float = 0.0
    complete: bool = True
    notes: list[str] = field(default_factory=list)
    lines: list[CostLine] = field(default_factory=list)


def _part_cost(part: Part, usage: dict[str, Any], prices: dict[str, ModelPrice]) -> _PartCost:
    cost = _PartCost()
    by_model = usage.get("by_model")
    for model, buckets in (by_model if isinstance(by_model, dict) else {}).items():
        price = prices.get(str(model))
        line_usd, priced = 0.0, True
        for bucket in BUCKETS:
            tokens = _tokens(buckets.get(bucket)) if isinstance(buckets, dict) else 0
            if not tokens:
                continue
            per_million = price.of(bucket) if price is not None else None
            if per_million is None:
                priced = False
                continue
            line_usd += tokens * per_million / PRICE_UNIT_TOKENS
        if not priced:
            cost.complete = False
            cost.notes.append(
                f"No price for some {model} tokens"
                if price is not None
                else f"No price for {model}: add it in Settings to include it"
            )
        cost.usd += line_usd
        cost.lines.append(CostLine(part, str(model), _usd(line_usd) if priced else None))
    notes = usage.get("notes")
    for code in notes if isinstance(notes, list) else []:
        if code in INCOMPLETE_NOTES:
            cost.complete = False
        if code in USAGE_NOTES:
            cost.notes.append(USAGE_NOTES[code])
    return cost


def _has_usage(usage: Any) -> bool:
    return isinstance(usage, dict) and isinstance(usage.get("by_model"), dict)


def run_cost(
    caller_usage: Any, judge_usage: Any, prices: list[ModelPrice] | dict[str, ModelPrice]
) -> RunCost | None:
    """The evaluator's cost of a run (its caller and its judge); None when neither has usage."""
    table = prices if isinstance(prices, dict) else {p.model: p for p in prices}
    parts: dict[Part, _PartCost | None] = {
        "caller": _part_cost("caller", caller_usage, table) if _has_usage(caller_usage) else None,
        "judge": _part_cost("judge", judge_usage, table) if _has_usage(judge_usage) else None,
    }
    present = [cost for cost in parts.values() if cost is not None]
    if not present:
        return None
    total = sum(cost.usd for cost in present)
    notes: list[str] = []
    for cost in present:
        notes.extend(note for note in cost.notes if note not in notes)
    caller, judge = parts["caller"], parts["judge"]
    return RunCost(
        caller_usd=_usd(caller.usd) if caller is not None else None,
        judge_usd=_usd(judge.usd) if judge is not None else None,
        total_usd=_usd(total) if math.isfinite(total) else 0.0,
        complete=all(cost.complete for cost in present),
        notes=notes,
        breakdown=[line for cost in present for line in cost.lines],
    )
