import pytest

from voice_eval.turns import AgentTurnDetector, ResponseTurnTracker


def test_greeting_turn_ends_after_silence_gap():
    d = AgentTurnDetector(silence_gap_ms=900)
    assert not d.agent_speaking
    d.on_agent_audio(100, nbytes=4800)
    d.on_agent_audio(300, nbytes=4800)
    assert d.agent_speaking
    assert not d.turn_ended(1100)
    assert d.turn_ended(1200)
    assert not d.agent_speaking
    (greeting,) = d.completed_turns
    assert greeting.first_audio_ms == 100
    assert greeting.last_activity_ms == 300
    assert greeting.audio_bytes == 9600
    assert greeting.latency_ms is None


def test_turn_ended_is_reported_once():
    d = AgentTurnDetector(silence_gap_ms=500)
    d.on_agent_audio(0)
    assert d.turn_ended(600)
    assert not d.turn_ended(700)
    assert len(d.completed_turns) == 1


def test_no_false_end_while_audio_keeps_arriving():
    d = AgentTurnDetector(silence_gap_ms=900)
    for t in range(0, 5000, 200):
        d.on_agent_audio(t)
        assert not d.turn_ended(t + 100)
    assert d.agent_speaking
    assert d.completed_turns == []


def test_caption_change_extends_open_turn_but_does_not_open_one():
    d = AgentTurnDetector(silence_gap_ms=900)
    d.on_caption_change(50)
    assert not d.agent_speaking
    d.on_agent_audio(100)
    d.on_caption_change(800)
    assert not d.turn_ended(1200)
    assert d.turn_ended(1700)


def test_latency_is_first_agent_audio_after_caller_end():
    d = AgentTurnDetector(silence_gap_ms=900)
    d.on_agent_audio(0)
    assert d.turn_ended(1000)
    d.mark_caller_end(5000)
    assert not d.agent_speaking
    d.on_agent_audio(5750)
    d.on_agent_audio(6000)
    assert d.turn_ended(7000)
    reply = d.completed_turns[-1]
    assert reply.caller_end_ms == 5000
    assert reply.latency_ms == 750
    assert d.latencies_ms() == [750]


def test_response_turn_spans_created_to_done_and_settles():
    t = ResponseTurnTracker(settle_ms=1200, fallback_gap_ms=5000)
    t.mark_caller_end(1000)
    t.on_response_started(1100)
    assert t.agent_speaking
    t.on_agent_audio(1400, nbytes=4800)
    t.on_agent_audio(1500, nbytes=4800)
    # 5500 ms of silence, past the 5000 ms fallback gap: the open response keeps the turn alive.
    assert not t.turn_ended(7000)
    t.on_response_done(7100)
    assert not t.turn_ended(8200)
    assert t.turn_ended(8300)
    (turn,) = t.completed_turns
    assert turn.latency_ms == 400
    assert turn.audio_bytes == 9600
    assert turn.response_count == 1
    assert turn.tool_activity is False
    assert turn.end_reason == "response_done"
    assert turn.end_ms == 7100


def test_tool_call_responses_and_processing_ticks_form_one_turn():
    t = ResponseTurnTracker(settle_ms=1200, fallback_gap_ms=5000)
    t.mark_caller_end(0)
    t.on_response_started(100)
    t.on_busy(150)  # function call arguments
    t.on_response_done(200)
    for tick in (1200, 2200, 3200):  # tool runs: processing every second
        assert not t.turn_ended(tick - 1)
        t.on_busy(tick)
    t.on_response_started(3500)
    t.on_agent_audio(3700, nbytes=4800)
    t.on_response_done(4000)
    assert not t.turn_ended(5000)
    assert t.turn_ended(5200)
    (turn,) = t.completed_turns
    assert turn.response_count == 2
    assert turn.tool_activity is True
    assert turn.latency_ms == 3700


def test_new_response_within_settle_window_keeps_turn_open():
    t = ResponseTurnTracker(settle_ms=1200, fallback_gap_ms=5000)
    t.on_response_started(0)
    t.on_response_done(100)
    t.on_response_started(900)
    assert not t.turn_ended(2200)
    t.on_response_done(1000)
    assert t.turn_ended(2200)
    assert [turn.response_count for turn in t.completed_turns] == [2]


def test_open_response_outlives_fallback_gap_until_the_stall_limit():
    t = ResponseTurnTracker(settle_ms=1200, fallback_gap_ms=3000, open_response_stall_ms=20000)
    t.on_response_started(0)
    t.on_agent_audio(500, nbytes=4800)
    for now in (3500, 10_000, 20_499):  # well past the fallback gap, still under the stall limit
        assert not t.turn_ended(now), now
    assert t.agent_speaking
    assert t.turn_ended(20_500)  # a dead server cannot hold the turn open forever
    (turn,) = t.completed_turns
    assert turn.end_reason == "stalled"
    assert turn.first_audio_ms == 500
    assert turn.end_ms == 500


def test_stall_limit_counts_from_the_last_activity_of_the_open_response():
    t = ResponseTurnTracker(settle_ms=1200, fallback_gap_ms=3000, open_response_stall_ms=10000)
    t.on_response_started(0)
    for tick in range(1000, 30_000, 1000):  # tool still running: processing every second
        assert not t.turn_ended(tick - 1)
        t.on_busy(tick)
    assert not t.turn_ended(38_999)
    assert t.turn_ended(39_000)
    assert t.completed_turns[0].end_reason == "stalled"


def test_audio_without_response_events_still_opens_a_turn():
    t = ResponseTurnTracker(settle_ms=1200, fallback_gap_ms=3000)
    t.mark_caller_end(0)
    t.on_agent_audio(250)
    assert t.agent_speaking
    assert not t.turn_ended(3249)
    assert t.turn_ended(3250)
    assert t.latencies_ms() == [250]
    assert t.completed_turns[0].end_reason == "fallback_gap"


def test_gap_detector_marks_end_reason_and_unknown_response_count():
    d = AgentTurnDetector(silence_gap_ms=500)
    d.on_agent_audio(0)
    assert d.turn_ended(600)
    turn = d.completed_turns[0]
    assert turn.end_reason == "audio_gap"
    assert turn.response_count is None and turn.tool_activity is None


def test_discarding_an_empty_turn_hands_its_caller_end_to_a_completed_next_turn():
    """The empty and the spoken turn both completed before the runner looked at them."""
    d = ResponseTurnTracker(settle_ms=100)
    d.mark_caller_end(1000)
    d.on_response_started(1100)
    d.on_response_done(1150)
    assert d.turn_ended(1300)  # the empty response: it holds the caller end
    d.on_response_started(1400)
    d.on_agent_audio(1600, nbytes=4800)
    d.on_response_done(1700)
    assert d.turn_ended(1900)
    empty, spoken = d.completed_turns
    assert spoken.caller_end_ms is None

    d.discard(empty)

    assert d.completed_turns == [spoken]
    assert spoken.latency_ms == 600
    d.on_agent_audio(5000)  # nothing is left pending for a later turn
    assert d.current_turn is not None and d.current_turn.caller_end_ms is None


def test_discarding_a_turn_that_is_not_completed_is_a_value_error():
    d = ResponseTurnTracker(settle_ms=100)
    d.on_response_started(100)
    d.on_agent_audio(150, nbytes=4800)
    d.on_response_done(200)
    assert d.turn_ended(400)
    (turn,) = d.completed_turns
    d.discard(turn)

    with pytest.raises(ValueError, match="not a completed turn"):
        d.discard(turn)
