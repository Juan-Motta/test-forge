"""AI-written input values: one structured chat call writes every input that asks for one."""

import json
from typing import Any

from voice_eval.modules.apiflows.domain import FlowInput
from voice_eval.modules.apiflows.runner import GenerationError, Generator
from voice_eval.providers.openai_chat import StructuredCallError, complete_json

TIMEOUT_S = 30.0

INSTRUCTIONS = (
    "You write realistic test values for the inputs of an API flow. For each input, follow its "
    "description and return one plausible value as text (numbers and booleans as their text, "
    "like 42 or true). Vary the values from run to run. Do not explain anything."
)


def _schema(items: list[FlowInput]) -> dict[str, Any]:
    names = [item.name for item in items]
    return {
        "name": "flow_inputs",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "values": {
                    "type": "object",
                    "properties": {name: {"type": "string"} for name in names},
                    "required": names,
                    "additionalProperties": False,
                }
            },
            "required": ["values"],
            "additionalProperties": False,
        },
    }


def chat_generator(client: Any, model: str, *, flow_name: str, flow_description: str) -> Generator:
    async def generate(items: list[FlowInput]) -> dict[str, str]:
        wanted = [
            {"name": item.name, "type": item.type.value, "description": item.generate}
            for item in items
        ]
        messages = [
            {"role": "system", "content": INSTRUCTIONS},
            {
                "role": "user",
                "content": json.dumps(
                    {"flow": flow_name, "purpose": flow_description, "inputs": wanted}
                ),
            },
        ]
        try:
            answer = await complete_json(
                client,
                model,
                messages,
                _schema(items),
                max_completion_tokens=2000,
                timeout_s=TIMEOUT_S,
                attempts=2,
                label="flow inputs",
            )
        except StructuredCallError as exc:
            raise GenerationError(f"AI could not write the inputs ({exc.detail})") from None
        values = answer.get("values")
        if not isinstance(values, dict):
            raise GenerationError("AI could not write the inputs (malformed answer)")
        return {name: str(value) for name, value in values.items()}

    return generate
