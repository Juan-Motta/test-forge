"""Barge-in arithmetic: where the simulated playback is cut and what the caller heard."""

import pytest

from voice_eval.audio import BYTES_PER_MS
from voice_eval.runner.barge_in import AudioItem, ItemCut, heard_text, playback_cuts


def item(item_id: str, ms: int, response_id: str = "resp_1") -> AudioItem:
    return AudioItem(item_id, response_id, ms * BYTES_PER_MS)


def test_cut_reports_the_playing_item_and_every_unstarted_one():
    items = [item("a", 1000), item("b", 1500), item("c", 500)]
    assert playback_cuts(items, 1600.7) == [
        ItemCut("b", "resp_1", 600),
        ItemCut("c", "resp_1", None),
    ]


def test_a_cut_at_an_item_boundary_reports_the_next_as_unstarted():
    items = [item("a", 1000), item("b", 1000)]
    assert playback_cuts(items, 1000) == [ItemCut("b", "resp_1", None)]


def test_played_ms_never_exceeds_the_received_audio():
    odd = AudioItem("a", "resp_1", 4801 * 2)  # 4801 samples: 200.04 ms
    assert playback_cuts([odd], 200.03) == [ItemCut("a", "resp_1", 200)]
    assert playback_cuts([odd], 5000) == []  # fully played: nothing is still playing
    for position in (0.5, 10, 199.99):
        (cut,) = playback_cuts([odd], position)
        assert cut.audio_end_ms is None or 0 <= cut.audio_end_ms <= odd.audio_bytes // 48


def test_played_ms_is_whole_samples_over_24():
    (cut,) = playback_cuts([item("a", 1000)], 123.99)
    assert cut.audio_end_ms == 123  # floor(2975 samples / 24)


@pytest.mark.parametrize(
    ("fraction", "expected"),
    [
        (0.0, ""),
        (0.05, ""),
        (0.3, "one two"),
        (0.5, "one two three"),
        (0.99, "one two three four five six"),
        (1.0, "one two three four five six seven"),
        (1.5, "one two three four five six seven"),
    ],
)
def test_heard_text_is_cut_proportionally_at_a_word_boundary(fraction, expected):
    assert heard_text("one two three four five six seven", fraction) == expected
