"""Port for the run judge's model: prepared messages in, the raw structured answer out.

The judge service builds the messages and validates the answer; it never sees how the answer
was produced (an LLM, a scripted fake in tests). Implementations raise `JudgeError` once they
give up.

The same model may also translate a finished judgement's texts (`JudgementTranslator`, the
`judge.translation` pass): prepared messages in, the raw `TRANSLATION_SCHEMA` answer out. A
model without `translate` simply leaves judgements untranslated.
"""

from typing import Any, Protocol


class RunJudgeModel(Protocol):
    async def judge(self, messages: list[dict[str, Any]]) -> dict[str, Any]: ...


class JudgementTranslator(Protocol):
    async def translate(self, messages: list[dict[str, Any]]) -> dict[str, Any]: ...
