"""The evaluator's run cost from recorded usage and the price table."""

import pytest

from voice_eval.modules.pricing.domain import SEED_PRICES, ModelPrice, run_cost
from voice_eval.ports.usage import TTS_AUDIO_NOT_METERED, TTS_TEXT_ESTIMATED

REALTIME = {
    "by_model": {
        "gpt-realtime-2.1-mini": {
            "audio_in": 1_000_000,  # $10
            "cached_audio_in": 1_000_000,  # $0.30
            "audio_out": 500_000,  # $10
            "text_in": 100_000,  # $0.06
            "text_out": 10_000,  # $0.024
        }
    }
}
JUDGE = {
    "by_model": {
        "gpt-6-luna": {"text_in": 2_000_000, "cached_text_in": 1_000_000, "text_out": 400_000}
    }
}


def test_a_realtime_run_costs_its_caller_plus_its_judge():
    cost = run_cost(REALTIME, JUDGE, list(SEED_PRICES))
    assert cost is not None
    assert cost.caller_usd == pytest.approx(20.384)
    assert cost.judge_usd == pytest.approx(0.2 + 0.01 + 0.2)
    assert cost.total_usd == pytest.approx(20.384 + 0.41)
    assert cost.complete is True
    assert cost.notes == []
    assert [(line.part, line.model) for line in cost.breakdown] == [
        ("caller", "gpt-realtime-2.1-mini"),
        ("judge", "gpt-6-luna"),
    ]


def test_tts_audio_makes_a_pipeline_cost_incomplete():
    pipeline = {
        "by_model": {
            "gpt-6-luna": {"text_in": 1_000_000, "text_out": 100_000},
            "gpt-4o-mini-tts": {"text_in": 1_000_000},
        },
        "notes": [TTS_AUDIO_NOT_METERED, TTS_TEXT_ESTIMATED],
    }
    cost = run_cost(pipeline, None, list(SEED_PRICES))
    assert cost.caller_usd == pytest.approx(0.10 + 0.05 + 0.60)
    assert cost.judge_usd is None
    assert cost.complete is False
    assert "TTS audio not priced: the speech endpoint reports no usage" in cost.notes


def test_tokens_without_a_price_make_the_cost_incomplete():
    usage = {"by_model": {"unknown-model": {"text_in": 10}, "gpt-6-luna": {"audio_in": 5}}}
    cost = run_cost(usage, None, list(SEED_PRICES))
    assert cost.caller_usd == 0
    assert cost.complete is False
    assert cost.notes == [
        "No price for unknown-model: add it in Settings to include it",
        "No price for some gpt-6-luna tokens",
    ]
    assert [line.usd for line in cost.breakdown] == [None, None]


def test_edited_prices_change_the_cost():
    prices = [ModelPrice(model="gpt-6-luna", text_in=1.0, cached_text_in=0, text_out=2.0)]
    cost = run_cost(None, JUDGE, prices)
    assert cost.caller_usd is None
    assert cost.judge_usd == pytest.approx(2.0 + 0.8)


@pytest.mark.parametrize("usage", [None, {}, {"by_model": "junk"}, "junk"])
def test_runs_without_usage_have_no_cost(usage):
    assert run_cost(usage, usage, list(SEED_PRICES)) is None
