"""The judge's response schema satisfies OpenAI strict structured outputs everywhere."""

from typing import Any

from voice_eval.judge.prompt import JUDGE_SCHEMA


def objects(node: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        if node.get("type") == "object":
            found.append(node)
        for value in node.values():
            found.extend(objects(value))
    elif isinstance(node, list):
        for value in node:
            found.extend(objects(value))
    return found


def test_is_a_strict_named_schema():
    assert JUDGE_SCHEMA["name"] == "run_judgement"
    assert JUDGE_SCHEMA["strict"] is True
    assert set(JUDGE_SCHEMA["schema"]["properties"]) == {
        "summary",
        "criteria",
        "suggestions",
        "strengths",
    }


def test_every_object_forbids_extra_keys_and_requires_all_of_them():
    found = objects(JUDGE_SCHEMA["schema"])
    assert len(found) == 4  # root, criterion, evidence, suggestion
    for node in found:
        assert node["additionalProperties"] is False
        assert sorted(node["required"]) == sorted(node["properties"])


def test_enums_match_the_domain():
    criterion = JUDGE_SCHEMA["schema"]["properties"]["criteria"]["items"]["properties"]
    assert criterion["verdict"]["enum"] == ["pass", "partial", "fail", "not_observable"]
    assert criterion["evidence"]["items"]["properties"]["source"]["enum"] == [
        "transcript",
        "trace",
        "timing",
    ]
    suggestion = JUDGE_SCHEMA["schema"]["properties"]["suggestions"]["items"]["properties"]
    assert suggestion["priority"]["enum"] == ["high", "medium", "low"]
    assert set(suggestion["area"]["enum"]) == {
        "prompt",
        "tools",
        "flow",
        "latency",
        "voice",
        "other",
    }
