"""The judgement translation pass: which texts are sent, what is protected, how the answer is
validated (retry once, then fail) and how a stored translation is swapped into the result.

The model is a scripted fake: nothing contacts a provider.
"""

import json
import re
from typing import Any

import pytest

from voice_eval.judge.domain import JudgeError
from voice_eval.judge.translation import (
    TRANSLATION_SCHEMA,
    TranslationError,
    _Masker,
    apply_translation,
    source_texts,
    translate_result,
)

QUOTE = "It is 120 dollars."
RESULT: dict[str, Any] = {
    "summary": "The agent stated the balance in A2.",
    "criteria": [
        {
            "criterionId": "c-1",
            "text": "States the balance",
            "rationale": "It said the balance in A2.",
            "evidence": [{"source": "transcript", "ref": "A2", "quote": QUOTE}],
        },
        {"criterionId": "c-2", "text": "Calls the tool", "rationale": "", "evidence": []},
    ],
    "suggestions": [
        {"title": "Cache the lookup", "detail": "Reply faster (T1).", "evidenceRefs": ["T1"]}
    ],
    "strengths": ["Clear answer"],
    "brief": (
        "# Voice agent review: Vivi / Balance\n\n## Problems found\n\n"
        "### [PARTIAL] States the balance\n- Failure tags: tool_or_trace_error\n"
        f'- Evidence (transcript A2): "{QUOTE}"\n'
    ),
}
TOKEN = re.compile(r"⟦\d+⟧")


def _sent(messages: list[dict[str, Any]]) -> dict[str, str]:
    payload = json.loads(messages[-1]["content"])
    return {item["key"]: item["text"] for item in payload["items"]}


def _spanish(sent: dict[str, str]) -> dict[str, Any]:
    """A well-formed answer: every text prefixed with "ES:", its tokens kept."""
    return {"items": [{"key": key, "text": f"ES: {text}"} for key, text in sent.items()]}


class FakeTranslator:
    """Answers each `translate` with the next scripted item (a callable of the sent texts, an
    exception or a fixed answer); the last item repeats."""

    def __init__(self, *script: Any) -> None:
        self.script = list(script) or [_spanish]
        self.calls: list[list[dict[str, Any]]] = []

    async def translate(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        self.calls.append(messages)
        item = self.script[min(len(self.calls), len(self.script)) - 1]
        if isinstance(item, Exception):
            raise item
        return item(_sent(messages)) if callable(item) else item


def test_the_schema_is_strict():
    assert TRANSLATION_SCHEMA["strict"] is True
    assert TRANSLATION_SCHEMA["schema"]["additionalProperties"] is False


def test_only_the_free_text_fields_are_sent():
    texts = source_texts(RESULT)
    assert set(texts) == {
        "summary",
        "criteria.0.rationale",
        "suggestions.0.title",
        "suggestions.0.detail",
        "strengths.0",
        "brief",
    }  # the empty rationale, criterion texts, quotes and refs are not


async def test_a_translation_swaps_in_every_text_and_keeps_quotes_refs_and_names():
    model = FakeTranslator()
    fields = await translate_result(model, RESULT, keep=["Vivi", "Balance"])

    sent = _sent(model.calls[0])
    everything = json.dumps(sent, ensure_ascii=False)
    for protected in (QUOTE, "A2", "T1", "States the balance", "Vivi", "tool_or_trace_error"):
        assert protected not in everything  # masked before sending
    assert TOKEN.search(sent["brief"])
    assert "neutral" in model.calls[0][0]["content"] and "tú" in model.calls[0][0]["content"]

    translated = apply_translation(RESULT, fields)
    assert translated["summary"] == "ES: The agent stated the balance in A2."
    assert translated["criteria"][0]["rationale"] == "ES: It said the balance in A2."
    assert translated["criteria"][1]["rationale"] == ""
    assert translated["criteria"][0]["text"] == "States the balance"
    assert translated["criteria"][0]["evidence"][0]["quote"] == QUOTE
    assert translated["suggestions"][0] == {
        "title": "ES: Cache the lookup",
        "detail": "ES: Reply faster (T1).",
        "evidenceRefs": ["T1"],
    }
    assert translated["strengths"] == ["ES: Clear answer"]
    assert f'"{QUOTE}"' in translated["brief"]
    assert "Vivi / Balance" in translated["brief"]
    assert translated["brief"].startswith("ES: # Voice agent review")
    assert RESULT["summary"] == "The agent stated the balance in A2."  # the original is untouched


def _missing_brief(sent: dict[str, str]) -> dict[str, Any]:
    return {"items": [item for item in _spanish(sent)["items"] if item["key"] != "brief"]}


def _lost_token(sent: dict[str, str]) -> dict[str, Any]:
    answer = _spanish(sent)
    for item in answer["items"]:
        item["text"] = TOKEN.sub("", item["text"])
    return answer


@pytest.mark.parametrize("bad", [_missing_brief, _lost_token, {"items": "nope"}, JudgeError("x")])
async def test_a_bad_answer_is_retried_once(bad):
    model = FakeTranslator(bad, _spanish)
    fields = await translate_result(model, RESULT)
    assert len(model.calls) == 2
    assert fields["summary"].startswith("ES: ")


async def test_two_bad_answers_fail_the_translation():
    model = FakeTranslator(_missing_brief)
    with pytest.raises(TranslationError, match="incomplete"):
        await translate_result(model, RESULT)
    assert len(model.calls) == 2


async def test_a_model_that_cannot_translate_fails_cleanly():
    with pytest.raises(TranslationError, match="cannot translate"):
        await translate_result(object(), RESULT)


def test_a_stale_translation_only_replaces_what_still_matches():
    fields = {
        "summary": "Resumen",
        "criteria": [{"criterionId": "other", "rationale": "nope"}],
        "suggestions": [],
        "strengths": ["a", "b"],
        "brief": "",
    }
    translated = apply_translation(RESULT, fields)
    assert translated["summary"] == "Resumen"
    assert translated["criteria"][0]["rationale"] == RESULT["criteria"][0]["rationale"]
    assert translated["suggestions"] == RESULT["suggestions"]
    assert translated["strengths"] == RESULT["strengths"]  # lengths differ: kept in English
    assert translated["brief"] == RESULT["brief"]  # empty: kept in English


def test_protected_terms_are_masked_only_as_whole_words():
    text = "Ana booked Room 12 in Anaheim; a banana and Room 123 were mentioned."
    masker = _Masker(["Ana", "Room 12"])
    masked = masker.mask(text)
    assert masked.count("⟦") == 2  # "Ana" and "Room 12" once each, not inside other words
    assert "Anaheim" in masked and "banana" in masked and "Room 123" in masked
    assert masker.unmask(masked) == text
