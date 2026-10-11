"""OpenAI / Azure OpenAI chat adapters with structured outputs: the caller policy and the judge.

gpt-6-luna is a reasoning model: every call asks for low effort, and the token budget leaves
room for its reasoning plus the answer; an empty or cut-off answer counts as malformed.
`complete_structured` is the shared call: one strict `json_schema` request, retried on a bad
answer or a provider error. The caller policy retries once and then hangs up safely with the
reason, so a run always ends cleanly; the judge retries once and then raises `JudgeError`.
Logs carry error types only, never the request, the answer or a secret.
"""

import asyncio
import json
import logging
from collections.abc import Callable
from typing import Any

import openai
from openai import AsyncAzureOpenAI, AsyncOpenAI

from voice_eval.evaluator.prompt import DECISION_SCHEMA, build_messages, parse_decision
from voice_eval.judge.domain import JudgeError
from voice_eval.judge.prompt import JUDGE_SCHEMA
from voice_eval.ports.policy import CallerDecision, PolicyState

log = logging.getLogger(__name__)

TIMEOUT_S = 30.0
MAX_COMPLETION_TOKENS = 4000  # reasoning tokens count against it too
REASONING_EFFORT = "low"  # sent on every call, OpenAI and Azure alike
ATTEMPTS = 2

JUDGE_TIMEOUT_S = 180.0  # the judge reads a whole call plus its traces
JUDGE_MAX_COMPLETION_TOKENS = 16000
JUDGE_ATTEMPTS = 2


class MalformedOutput(ValueError):
    """The model's answer is missing, cut off, refused or not the expected JSON."""


class StructuredCallError(Exception):
    """Every attempt failed. `malformed` tells a bad answer from an unavailable model."""

    def __init__(self, detail: str, *, malformed: bool) -> None:
        super().__init__(detail)
        self.detail = detail
        self.malformed = malformed


class _ClientCallError(Exception):
    """The client call itself failed with an error that is not about the answer."""


def parse_json_object(text: str) -> dict[str, Any]:
    try:
        data = json.loads(text)
    except ValueError:
        raise MalformedOutput("answer is not JSON") from None
    if not isinstance(data, dict):
        raise MalformedOutput("answer is not a JSON object")
    return data


async def _ask_once[T](
    client: Any,
    *,
    model: str,
    messages: list[dict[str, Any]],
    json_schema: dict[str, Any],
    max_completion_tokens: int,
    timeout_s: float,
    parse: Callable[[str], T],
) -> T:
    try:
        async with asyncio.timeout(timeout_s):
            completion = await client.chat.completions.create(
                model=model,
                messages=messages,
                response_format={"type": "json_schema", "json_schema": json_schema},
                max_completion_tokens=max_completion_tokens,
                reasoning_effort=REASONING_EFFORT,
                timeout=timeout_s,
            )
    except ValueError as exc:
        # Raised before any answer exists; its message may echo request data, so keep only the type.
        raise _ClientCallError(type(exc).__name__) from None
    if not completion.choices:
        raise MalformedOutput("no answer")
    choice = completion.choices[0]
    message = choice.message
    if getattr(message, "refusal", None):
        raise MalformedOutput("the model refused")
    if getattr(choice, "finish_reason", None) == "length":
        raise MalformedOutput("the answer was cut off by the token limit")
    if not (message.content or "").strip():
        raise MalformedOutput("empty answer")
    return parse(message.content)


async def complete_structured[T](
    client: Any,
    *,
    model: str,
    messages: list[dict[str, Any]],
    json_schema: dict[str, Any],
    max_completion_tokens: int,
    timeout_s: float,
    attempts: int,
    parse: Callable[[str], T],
    label: str,
) -> T:
    """One structured-output answer parsed by `parse` (any `ValueError` there is malformed).

    Raises `StructuredCallError` with the last problem once every attempt failed.
    """
    failure = StructuredCallError("no attempt was made", malformed=False)
    for attempt in range(1, attempts + 1):
        try:
            return await _ask_once(
                client,
                model=model,
                messages=messages,
                json_schema=json_schema,
                max_completion_tokens=max_completion_tokens,
                timeout_s=timeout_s,
                parse=parse,
            )
        except ValueError as exc:  # MalformedOutput, MalformedDecision, ...
            failure = StructuredCallError(str(exc), malformed=True)
        except _ClientCallError as exc:
            failure = StructuredCallError(str(exc), malformed=False)
        except (TimeoutError, openai.APIError) as exc:
            failure = StructuredCallError(type(exc).__name__, malformed=False)
        kind = "malformed answer" if failure.malformed else "model unavailable"
        log.warning("%s attempt %d failed: %s (%s)", label, attempt, kind, failure.detail)
    raise failure


async def complete_json(
    client: Any,
    model: str,
    messages: list[dict[str, Any]],
    json_schema: dict[str, Any],
    *,
    max_completion_tokens: int,
    timeout_s: float,
    attempts: int,
    label: str = "structured call",
) -> dict[str, Any]:
    """The answer as a JSON object (shape checks are the caller's)."""
    return await complete_structured(
        client,
        model=model,
        messages=messages,
        json_schema=json_schema,
        max_completion_tokens=max_completion_tokens,
        timeout_s=timeout_s,
        attempts=attempts,
        parse=parse_json_object,
        label=label,
    )


def openai_client(api_key: str, base_url: str | None = None) -> AsyncOpenAI:
    # Retries are ours (see complete_structured); the SDK's would multiply the wait.
    return AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=0)


def azure_client(api_key: str, endpoint: str, api_version: str) -> AsyncAzureOpenAI:
    return AsyncAzureOpenAI(
        api_key=api_key, azure_endpoint=endpoint, api_version=api_version, max_retries=0
    )


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
        return cls(openai_client(api_key, base_url), model)

    @classmethod
    def for_azure(
        cls, api_key: str, endpoint: str, api_version: str, deployment: str
    ) -> "OpenAIChatPolicy":
        # Azure routes by deployment name, which goes in the `model` field.
        return cls(azure_client(api_key, endpoint, api_version), deployment)

    async def next_turn(self, state: PolicyState) -> CallerDecision:
        try:
            return await complete_structured(
                self.client,
                model=self.model,
                messages=build_messages(state),
                json_schema=DECISION_SCHEMA,
                max_completion_tokens=MAX_COMPLETION_TOKENS,
                timeout_s=self.timeout_s,
                attempts=ATTEMPTS,
                parse=parse_decision,
                label="caller policy",
            )
        except StructuredCallError as exc:
            if exc.malformed:
                problem = f"malformed evaluator answer ({exc.detail})"
            else:
                problem = f"evaluator model unavailable ({exc.detail})"
            return CallerDecision(say=None, hang_up=True, reason=problem)


class OpenAIJudge:
    """The run judge: one strict `JUDGE_SCHEMA` answer for the prepared messages."""

    def __init__(self, client: Any, model: str, *, timeout_s: float = JUDGE_TIMEOUT_S) -> None:
        if not model.strip():
            raise ValueError("a chat model (or Azure deployment) is required")
        self.client = client
        self.model = model
        self.timeout_s = timeout_s

    def __repr__(self) -> str:
        return f"OpenAIJudge(model={self.model!r})"

    @classmethod
    def for_openai(cls, api_key: str, model: str, *, base_url: str | None = None) -> "OpenAIJudge":
        return cls(openai_client(api_key, base_url), model)

    @classmethod
    def for_azure(
        cls, api_key: str, endpoint: str, api_version: str, deployment: str
    ) -> "OpenAIJudge":
        return cls(azure_client(api_key, endpoint, api_version), deployment)

    async def judge(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        try:
            return await complete_json(
                self.client,
                self.model,
                messages,
                JUDGE_SCHEMA,
                max_completion_tokens=JUDGE_MAX_COMPLETION_TOKENS,
                timeout_s=self.timeout_s,
                attempts=JUDGE_ATTEMPTS,
                label="run judge",
            )
        except StructuredCallError as exc:
            if exc.malformed:
                raise JudgeError(f"malformed judge answer ({exc.detail})") from None
            raise JudgeError(f"judge model unavailable ({exc.detail})") from None
