"""Which provider connection plays the evaluator's chat model for a scenario."""

import uuid

import pytest

from voice_eval.modules.scenarios.domain import (
    ConnectionRef,
    ScenarioNotRunnable,
    resolve_evaluator,
)


def ref(name: str, chat_model: str | None) -> ConnectionRef:
    return ConnectionRef(id=uuid.uuid4(), name=name, chat_model=chat_model)


def test_the_explicit_evaluator_connection_wins():
    evaluator, tts = ref("Chat", "gpt-4.1"), ref("Voice", "gpt-4.1-mini")
    assert resolve_evaluator(evaluator=evaluator, tts=tts) == evaluator


def test_falls_back_to_the_voice_connection_when_it_can_chat():
    tts = ref("Voice", "gpt-4.1-mini")
    assert resolve_evaluator(evaluator=None, tts=tts) == tts


def test_an_explicit_evaluator_without_chat_model_is_not_runnable():
    with pytest.raises(ScenarioNotRunnable) as info:
        resolve_evaluator(evaluator=ref("Azure chat", None), tts=ref("Voice", "gpt-4.1-mini"))
    assert "Azure chat" in info.value.reason
    assert "chat deployment" in info.value.reason


def test_a_voice_connection_without_chat_model_is_not_runnable():
    with pytest.raises(ScenarioNotRunnable) as info:
        resolve_evaluator(evaluator=None, tts=ref("Azure voice", None))
    assert "Azure voice" in info.value.reason
    assert "evaluator model connection" in info.value.reason


def test_no_connection_at_all_is_not_runnable():
    with pytest.raises(ScenarioNotRunnable) as info:
        resolve_evaluator(evaluator=None, tts=None)
    assert "evaluator model connection" in info.value.reason
    assert str(info.value) == info.value.reason
