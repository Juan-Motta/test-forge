"""Criteria whose evidence source is missing are decided in code before the model is asked."""

import pytest
from judge_support import CRITERIA, MUST_ID, SHOULD_ID, SUMMARY, TRACE_ID

from voice_eval.judge.gating import gate_criteria, has_timing_data


def test_a_trace_criterion_without_traces_is_traces_unavailable():
    assert gate_criteria(CRITERIA, has_traces=False, summary=SUMMARY) == {
        TRACE_ID: "traces_unavailable"
    }


def test_nothing_is_gated_when_every_source_is_there():
    assert gate_criteria(CRITERIA, has_traces=True, summary=SUMMARY) == {}


def test_a_timing_criterion_without_turn_timings_is_no_timing_data():
    gated = gate_criteria(CRITERIA, has_traces=False, summary={"status": "completed"})
    assert gated == {SHOULD_ID: "no_timing_data", TRACE_ID: "traces_unavailable"}
    assert MUST_ID not in gated  # transcript criteria are always sent to the judge


@pytest.mark.parametrize(
    ("summary", "expected"),
    [
        ({}, False),
        ({"turns": [], "latencies_ms": []}, False),
        ({"turns": [{"index": 0, "kind": "reply"}]}, False),  # a turn with no number
        ({"turns": [{"first_audio_ms": "soon"}]}, False),
        ({"turns": [{"first_audio_ms": True}]}, False),
        ({"latencies_ms": [None, "x"]}, False),
        ({"latencies_ms": [900.0]}, True),
        ({"turns": [{"end_ms": 2500.0}]}, True),
        (SUMMARY, True),
        ("not a dict", False),
    ],
)
def test_usable_turn_timings(summary, expected):
    assert has_timing_data(summary) is expected
