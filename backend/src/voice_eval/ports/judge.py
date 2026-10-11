"""Port for the run judge's model: prepared messages in, the raw structured answer out.

The judge service builds the messages and validates the answer; it never sees how the answer
was produced (an LLM, a scripted fake in tests). Implementations raise `JudgeError` once they
give up.
"""

from typing import Any, Protocol


class RunJudgeModel(Protocol):
    async def judge(self, messages: list[dict[str, Any]]) -> dict[str, Any]: ...
