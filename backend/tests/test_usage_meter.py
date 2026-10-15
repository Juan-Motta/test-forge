"""The evaluator's token usage meter: per-model buckets, notes, and merging."""

from types import SimpleNamespace

from voice_eval.ports.usage import (
    TTS_AUDIO_NOT_METERED,
    UsageMeter,
    collect_usage,
    merge_usage,
    usage_since,
)


def test_an_empty_meter_has_no_usage():
    assert UsageMeter().to_dict() is None


def test_counts_add_up_per_model_and_bucket():
    meter = UsageMeter()
    meter.add("gpt-6-luna", text_in=100, cached_text_in=20, text_out=50)
    meter.add("gpt-6-luna", text_in=1, text_out=2)
    meter.add("gpt-4o-mini-tts", text_in=3)
    assert meter.to_dict() == {
        "by_model": {
            "gpt-6-luna": {"text_in": 101, "cached_text_in": 20, "text_out": 52},
            "gpt-4o-mini-tts": {"text_in": 3},
        }
    }


def test_bad_counts_and_unknown_buckets_are_ignored():
    meter = UsageMeter()
    meter.add("m", text_in=-5, text_out=None, audio_out=True, video_in=9, audio_in=0)
    assert meter.to_dict() is None


def test_notes_are_kept_sorted_without_duplicates():
    meter = UsageMeter()
    meter.add("gpt-4o-mini-tts", text_in=3)
    meter.note(TTS_AUDIO_NOT_METERED)
    meter.note(TTS_AUDIO_NOT_METERED)
    assert meter.to_dict()["notes"] == [TTS_AUDIO_NOT_METERED]


def test_merge_sums_usages_and_skips_missing_ones():
    a = {"by_model": {"m": {"text_in": 1}}, "notes": ["x"]}
    b = {"by_model": {"m": {"text_in": 2, "text_out": 3}, "n": {"audio_out": 4}}}
    assert merge_usage(a, None, b) == {
        "by_model": {"m": {"text_in": 3, "text_out": 3}, "n": {"audio_out": 4}},
        "notes": ["x"],
    }
    assert merge_usage(None, {}) is None
    assert merge_usage({"by_model": "junk"}) is None


def test_collect_reads_the_meters_of_the_providers_that_have_one():
    meter = UsageMeter()
    meter.add("gpt-6-luna", text_in=5)
    fake_without_meter = SimpleNamespace()
    assert collect_usage(None, fake_without_meter, SimpleNamespace(usage=meter)) == {
        "by_model": {"gpt-6-luna": {"text_in": 5}}
    }
    assert collect_usage(None, fake_without_meter) is None


def test_usage_since_is_what_a_reused_meter_added():
    meter = UsageMeter()
    meter.add("gpt-6-luna", text_in=100, text_out=10)
    before = meter.to_dict()
    assert usage_since(before, meter.to_dict()) is None
    meter.add("gpt-6-luna", text_in=40, text_out=5)
    meter.add("other", text_in=1)
    assert usage_since(before, meter.to_dict()) == {
        "by_model": {"gpt-6-luna": {"text_in": 40, "text_out": 5}, "other": {"text_in": 1}}
    }
    assert usage_since(None, before) == before
    assert usage_since(before, None) is None
