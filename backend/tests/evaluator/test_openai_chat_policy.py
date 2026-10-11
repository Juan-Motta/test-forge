"""OpenAI / Azure OpenAI chat adapter of the caller policy, against a fake chat client."""

import asyncio
import logging
from types import SimpleNamespace

import httpx
import openai
import pytest
from openai import AsyncAzureOpenAI, AsyncOpenAI

from voice_eval.evaluator.prompt import DECISION_SCHEMA, build_messages
from voice_eval.ports.policy import CallerBrief, CallerDecision, PolicyState
from voice_eval.providers.openai_chat import OpenAIChatPolicy

BRIEF = CallerBrief(
    agent_context="",
    scenario_context="",
    persona_name="Ana",
    locale="en-US",
    temperament="calm",
    persona_notes="",
    goal="Book a table.",
    instructions="",
    facts=(),
    hang_up_when="goal_or_goodbye",
    max_duration_s=120,
)
STATE = PolicyState(brief=BRIEF)
SECRET = "sk-chat-secret-abcdefghijkl"


def completion(content: str | None, refusal: str | None = None, finish_reason: str = "stop"):
    message = SimpleNamespace(content=content, refusal=refusal)
    return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason=finish_reason)])


class FakeCompletions:
    """Answers each `create` call with the next scripted item (an exception is raised)."""

    def __init__(self, *answers) -> None:
        self.answers = list(answers)
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        answer = self.answers.pop(0)
        if isinstance(answer, BaseException):
            raise answer
        if callable(answer):
            return await answer()
        return answer


def fake_client(*answers) -> SimpleNamespace:
    return SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions(*answers)))


def calls(policy: OpenAIChatPolicy) -> list[dict]:
    return policy.client.chat.completions.calls


async def test_sends_the_prompt_with_the_strict_schema_and_returns_the_decision():
    policy = OpenAIChatPolicy(
        fake_client(
            completion('{"say": "Hi, a table for two?", "hangUp": false, "reason": "ask"}')
        ),
        "gpt-6-luna",
    )
    decision = await policy.next_turn(STATE)
    assert decision == CallerDecision("Hi, a table for two?", False, "ask")
    (call,) = calls(policy)
    assert call["model"] == "gpt-6-luna"
    assert call["messages"] == build_messages(STATE)
    assert call["response_format"] == {"type": "json_schema", "json_schema": DECISION_SCHEMA}
    assert call["timeout"] == policy.timeout_s == 30
    assert call["max_completion_tokens"] == 4000  # room for reasoning tokens plus the answer
    assert call["reasoning_effort"] == "low"  # always, for OpenAI and Azure alike


@pytest.mark.parametrize(
    "bad",
    [
        completion(None),  # no content at all
        completion(""),
        completion("   "),
        completion('{"say": "Hi", "ha', finish_reason="length"),  # cut off by the token limit
        SimpleNamespace(choices=[]),
    ],
)
async def test_an_empty_or_truncated_answer_is_malformed_then_hangs_up_safely(bad):
    policy = OpenAIChatPolicy(fake_client(bad, bad), "m")
    decision = await policy.next_turn(STATE)
    assert (decision.say, decision.hang_up) == (None, True)
    assert "malformed" in decision.reason
    assert len(calls(policy)) == 2


async def test_a_truncated_answer_is_retried():
    policy = OpenAIChatPolicy(
        fake_client(
            completion("", finish_reason="length"),
            completion('{"say": "Hi", "hangUp": false, "reason": "r"}'),
        ),
        "m",
    )
    assert (await policy.next_turn(STATE)).say == "Hi"


async def test_retries_once_on_malformed_output():
    policy = OpenAIChatPolicy(
        fake_client(
            completion("not json"), completion('{"say": "Hi", "hangUp": false, "reason": "r"}')
        ),
        "m",
    )
    assert (await policy.next_turn(STATE)).say == "Hi"
    assert len(calls(policy)) == 2


async def test_falls_back_to_a_safe_hang_up_after_two_malformed_outputs():
    policy = OpenAIChatPolicy(fake_client(completion("{}"), completion(None, refusal="no")), "m")
    decision = await policy.next_turn(STATE)
    assert (decision.say, decision.hang_up) == (None, True)
    assert "malformed" in decision.reason
    assert len(calls(policy)) == 2


async def test_provider_errors_and_timeouts_retry_once_then_hang_up(caplog):
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    policy = OpenAIChatPolicy(
        fake_client(openai.APITimeoutError(request), openai.APIConnectionError(request=request)),
        "m",
    )
    with caplog.at_level(logging.WARNING):
        decision = await policy.next_turn(STATE)
    assert (decision.say, decision.hang_up) == (None, True)
    assert "APIConnectionError" in decision.reason
    assert len(calls(policy)) == 2
    assert SECRET not in caplog.text


async def test_a_hung_call_is_bounded_by_the_policy_timeout():
    async def never():
        await asyncio.sleep(10)

    policy = OpenAIChatPolicy(
        fake_client(never, completion('{"say": "Hi", "hangUp": false, "reason": "r"}')),
        "m",
        timeout_s=0.05,
    )
    assert (await policy.next_turn(STATE)).say == "Hi"


def test_openai_client_is_built_from_the_connection_values():
    policy = OpenAIChatPolicy.for_openai(
        SECRET, "gpt-6-luna", base_url="https://proxy.example.com/v1"
    )
    assert isinstance(policy.client, AsyncOpenAI)
    assert policy.model == "gpt-6-luna"
    assert str(policy.client.base_url) == "https://proxy.example.com/v1/"
    assert SECRET not in repr(policy)


def test_azure_client_routes_by_deployment():
    policy = OpenAIChatPolicy.for_azure(
        SECRET, "https://res.openai.azure.com", "2025-03-01-preview", "my-chat"
    )
    assert isinstance(policy.client, AsyncAzureOpenAI)
    assert policy.model == "my-chat"


@pytest.mark.parametrize("bad", ["", "   "])
def test_requires_a_model(bad):
    with pytest.raises(ValueError):
        OpenAIChatPolicy(fake_client(), bad)
