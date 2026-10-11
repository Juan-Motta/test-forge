"""OpenAI / Azure OpenAI chat adapter for the CallerPolicy port (structured outputs).

gpt-6-luna is a reasoning model: every call asks for low effort, and the token budget leaves
room for its reasoning plus the answer; an empty or cut-off answer counts as malformed.
One bad answer or provider error is retried once; after that the policy hangs up safely with
the reason, so a run always ends cleanly. Logs carry error types only, never the request,
the answer or a secret.
"""

import asyncio
import logging
from typing import Any

import openai
from openai import AsyncAzureOpenAI, AsyncOpenAI

from voice_eval.evaluator.prompt import (
    DECISION_SCHEMA,
    MalformedDecision,
    build_messages,
    parse_decision,
)
from voice_eval.ports.policy import CallerDecision, PolicyState

log = logging.getLogger(__name__)

TIMEOUT_S = 30.0
MAX_COMPLETION_TOKENS = 4000  # reasoning tokens count against it too
REASONING_EFFORT = "low"  # sent on every call, OpenAI and Azure alike
ATTEMPTS = 2


class OpenAIChatPolicy:
    def __init__(self, client: Any, model: str, *, timeout_s: float = TIMEOUT_S) -> None:
        if not model.strip():
            raise ValueError("a chat model (or Azure deployment) is required")
        self.client = client
        self.model = model
        self.timeout_s = timeout_s

    def __repr__(self) -> str:
        return f"OpenAIChatPolicy(model={self.model!r})"

    @classmethod
    def for_openai(
        cls, api_key: str, model: str, *, base_url: str | None = None
    ) -> "OpenAIChatPolicy":
        # Retries are ours (one, see next_turn); the SDK's would multiply the wait.
        client = AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=0)
        return cls(client, model)

    @classmethod
    def for_azure(
        cls, api_key: str, endpoint: str, api_version: str, deployment: str
    ) -> "OpenAIChatPolicy":
        client = AsyncAzureOpenAI(
            api_key=api_key, azure_endpoint=endpoint, api_version=api_version, max_retries=0
        )
        # Azure routes by deployment name, which goes in the `model` field.
        return cls(client, deployment)

    async def _ask(self, state: PolicyState) -> CallerDecision:
        async with asyncio.timeout(self.timeout_s):
            completion = await self.client.chat.completions.create(
                model=self.model,
                messages=build_messages(state),
                response_format={"type": "json_schema", "json_schema": DECISION_SCHEMA},
                max_completion_tokens=MAX_COMPLETION_TOKENS,
                reasoning_effort=REASONING_EFFORT,
                timeout=self.timeout_s,
            )
        if not completion.choices:
            raise MalformedDecision("no answer")
        choice = completion.choices[0]
        message = choice.message
        if getattr(message, "refusal", None):
            raise MalformedDecision("the model refused")
        if getattr(choice, "finish_reason", None) == "length":
            raise MalformedDecision("the answer was cut off by the token limit")
        if not (message.content or "").strip():
            raise MalformedDecision("empty answer")
        return parse_decision(message.content)

    async def next_turn(self, state: PolicyState) -> CallerDecision:
        problem = ""
        for attempt in range(1, ATTEMPTS + 1):
            try:
                return await self._ask(state)
            except MalformedDecision as exc:
                problem = f"malformed evaluator answer ({exc})"
            except (TimeoutError, openai.APIError) as exc:
                problem = f"evaluator model unavailable ({type(exc).__name__})"
            log.warning("caller policy attempt %d failed: %s", attempt, problem)
        return CallerDecision(say=None, hang_up=True, reason=problem)
