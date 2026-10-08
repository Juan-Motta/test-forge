from voice_eval.turns import AgentTurnDetector


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
