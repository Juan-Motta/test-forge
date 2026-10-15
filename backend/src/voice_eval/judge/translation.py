"""Translated versions of a judgement's free text, made after the judgement by the judge's model.

The judge reasons and writes in English on purpose (stability, see `prompt`). After a
judgement completes, one structured call translates its free-text fields (the summary, each
criterion's rationale, the suggestions' titles and details, the strengths and the Markdown
brief) into another language. Nothing else is sent: criterion texts, evidence quotes, refs,
tags, names, ids and numbers stay as stored.

Protected terms that appear inside the sent texts (evidence quotes, criterion texts, names and
ids passed as `keep`, refs like `A3`/`T1`, snake_case tags and inline code) are replaced by
opaque tokens (`⟦n⟧`) before the call and restored after it, so they come back verbatim. The
answer must return every key with every token it was given; otherwise the call is asked once
more and then `TranslationError` is raised (the judgement itself is never affected).

The stored translation (`fields`) mirrors the result's camelCase shape for those texts only;
`apply_translation` swaps it into a stored result.
"""

import json
import logging
import re
from collections import Counter
from collections.abc import Iterable
from typing import Any, Literal, get_args

from voice_eval.judge.domain import JudgeError

log = logging.getLogger(__name__)

Language = Literal["en", "es"]
TranslatedLanguage = Literal["es"]
LANGUAGES: tuple[str, ...] = get_args(TranslatedLanguage)
LANGUAGE_NAMES = {"es": "Spanish"}
ATTEMPTS = 2  # the first answer plus one retry on a partial or malformed one

TRANSLATION_SCHEMA: dict[str, Any] = {
    "name": "judgement_translation",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "description": "Every input item, translated, with its key unchanged.",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "description": "The input item's key."},
                        "text": {"type": "string", "description": "The translated text."},
                    },
                    "required": ["key", "text"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["items"],
        "additionalProperties": False,
    },
}

SYSTEM_PROMPT = """\
You translate the written review of a QA judge from English into {language}.

- Write neutral, professional {language}; address the reader as "tú" when addressing them.
- Translate every item's text and return every item with its key unchanged.
- Tokens like ⟦3⟧ stand for text that must not change (quotes, names, references, tags, \
code): copy each token exactly, as many times as it appears, and never translate around it \
in a way that drops it.
- Keep the Markdown structure exactly: headings (#), list markers, numbering, bold, line \
breaks and blank lines. Keep numbers, scores and ids as they are.
- Do not add, remove or summarize content. Answer only with the JSON object of the response \
schema.\
"""

_TOKEN = re.compile(r"⟦\d+⟧")
_REF = r"\b[ACTR]\d+\b"  # evidence refs: A3, C2, T1, R4
_SNAKE = r"\b[a-z]+(?:_[a-z0-9]+)+\b"  # failure tags, reasons, ids
_CODE = r"`[^`\n]+`"
MIN_TERM = 2


class TranslationError(Exception):
    """The judgement could not be translated; the message is safe to store and show."""


class _Masker:
    """Replaces protected terms by `⟦n⟧` tokens (one token per distinct term) and back."""

    def __init__(self, terms: Iterable[str]) -> None:
        literal = sorted(
            {t for t in terms if len(t.strip()) >= MIN_TERM and "⟦" not in t},
            key=len,
            reverse=True,
        )
        self._pattern = re.compile(
            "|".join([*(re.escape(term) for term in literal), _CODE, _REF, _SNAKE])
        )
        self._tokens: dict[str, str] = {}
        self._terms: dict[str, str] = {}

    def _token(self, match: re.Match[str]) -> str:
        term = match.group(0)
        if term not in self._tokens:
            token = f"⟦{len(self._tokens) + 1}⟧"
            self._tokens[term], self._terms[token] = token, term
        return self._tokens[term]

    def mask(self, text: str) -> str:
        return self._pattern.sub(self._token, text)

    def unmask(self, text: str) -> str:
        return _TOKEN.sub(lambda match: self._terms.get(match.group(0), match.group(0)), text)


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def source_texts(result: dict[str, Any]) -> dict[str, str]:
    """The stored result's non-empty free texts by stable key (what gets translated)."""
    texts: dict[str, str] = {"summary": _text(result.get("summary"))}
    for index, criterion in enumerate(_list(result.get("criteria"))):
        texts[f"criteria.{index}.rationale"] = _text(_dict(criterion).get("rationale"))
    for index, suggestion in enumerate(_list(result.get("suggestions"))):
        texts[f"suggestions.{index}.title"] = _text(_dict(suggestion).get("title"))
        texts[f"suggestions.{index}.detail"] = _text(_dict(suggestion).get("detail"))
    for index, strength in enumerate(_list(result.get("strengths"))):
        texts[f"strengths.{index}"] = _text(strength)
    texts["brief"] = _text(result.get("brief"))
    return {key: text for key, text in texts.items() if text.strip()}


def _protected_terms(result: dict[str, Any], keep: Iterable[str]) -> list[str]:
    """Evidence quotes and criterion texts (as stored and on one line, as the brief writes
    them), plus the caller's `keep` (names, ids)."""
    terms: list[str] = [str(term) for term in keep if term]
    for criterion in _list(result.get("criteria")):
        criterion = _dict(criterion)
        terms.append(_text(criterion.get("text")))
        for item in _list(criterion.get("evidence")):
            terms.append(_text(_dict(item).get("quote")))
    return [form for term in terms for form in {term.strip(), " ".join(term.split())} if form]


def build_messages(texts: dict[str, str], language: TranslatedLanguage) -> list[dict[str, Any]]:
    items = [{"key": key, "text": text} for key, text in texts.items()]
    return [
        {"role": "system", "content": SYSTEM_PROMPT.format(language=LANGUAGE_NAMES[language])},
        {"role": "user", "content": json.dumps({"items": items}, ensure_ascii=False)},
    ]


def parse_translation(raw: Any, sent: dict[str, str]) -> dict[str, str]:
    """The translated text of every sent key. Raises `TranslationError` when the answer is out
    of shape, misses a key or changes a key's tokens."""
    items = raw.get("items") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        raise TranslationError("malformed translation (does not match the schema)")
    answer: dict[str, str] = {}
    for item in items:
        if isinstance(item, dict) and isinstance(item.get("key"), str):
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                answer.setdefault(item["key"], text)
    for key, text in sent.items():
        if key not in answer or Counter(_TOKEN.findall(answer[key])) != Counter(
            _TOKEN.findall(text)
        ):
            raise TranslationError("incomplete translation (a text or protected term is missing)")
    return {key: answer[key] for key in sent}


def localized_fields(result: dict[str, Any], texts: dict[str, str]) -> dict[str, Any]:
    """The stored translation: the result's text fields with `texts` (by key) swapped in;
    a text that was not sent (empty) stays as it was."""

    def pick(key: str, original: Any) -> str:
        return texts.get(key, _text(original))

    return {
        "summary": pick("summary", result.get("summary")),
        "criteria": [
            {
                "criterionId": _dict(criterion).get("criterionId"),
                "rationale": pick(f"criteria.{i}.rationale", _dict(criterion).get("rationale")),
            }
            for i, criterion in enumerate(_list(result.get("criteria")))
        ],
        "suggestions": [
            {
                "title": pick(f"suggestions.{i}.title", _dict(suggestion).get("title")),
                "detail": pick(f"suggestions.{i}.detail", _dict(suggestion).get("detail")),
            }
            for i, suggestion in enumerate(_list(result.get("suggestions")))
        ],
        "strengths": [
            pick(f"strengths.{i}", strength)
            for i, strength in enumerate(_list(result.get("strengths")))
        ],
        "brief": pick("brief", result.get("brief")),
    }


def apply_translation(result: dict[str, Any], fields: dict[str, Any]) -> dict[str, Any]:
    """A copy of the stored `result` with the translated `fields` swapped in. Only what still
    matches is replaced (criteria by id, suggestions and strengths when their count matches,
    non-empty texts), so a stale or partial translation never mixes up items."""
    out = dict(result)
    fields = _dict(fields)
    for key in ("summary", "brief"):
        if _text(fields.get(key)).strip():
            out[key] = fields[key]
    rationales = {
        item.get("criterionId"): _text(item.get("rationale"))
        for item in map(_dict, _list(fields.get("criteria")))
    }
    out["criteria"] = [
        {**criterion, "rationale": rationales[criterion.get("criterionId")]}
        if isinstance(criterion, dict) and rationales.get(criterion.get("criterionId"), "").strip()
        else criterion
        for criterion in _list(result.get("criteria"))
    ]
    suggestions, translated = _list(result.get("suggestions")), _list(fields.get("suggestions"))
    if len(translated) == len(suggestions):
        out["suggestions"] = [
            {
                **original,
                **{
                    key: _dict(item)[key]
                    for key in ("title", "detail")
                    if _text(_dict(item).get(key)).strip()
                },
            }
            if isinstance(original, dict)
            else original
            for original, item in zip(suggestions, translated, strict=True)
        ]
    strengths = _list(fields.get("strengths"))
    if len(strengths) == len(_list(result.get("strengths"))) and all(
        _text(text).strip() for text in strengths
    ):
        out["strengths"] = list(strengths)
    return out


async def translate_result(
    model: Any,
    result: dict[str, Any],
    *,
    keep: Iterable[str] = (),
    language: TranslatedLanguage = "es",
) -> dict[str, Any]:
    """The translated `fields` of a stored judgement `result` (camelCase), from one structured
    call of `model.translate` (asked once more on a bad answer).

    Raises `TranslationError` when the model cannot translate or both answers are bad.
    """
    translate = getattr(model, "translate", None)
    if translate is None:
        raise TranslationError("the judge model cannot translate")
    texts = source_texts(result)
    if not texts:
        return localized_fields(result, {})
    masker = _Masker(_protected_terms(result, keep))
    sent = {key: masker.mask(text) for key, text in texts.items()}
    messages = build_messages(sent, language)
    failure = TranslationError("no translation attempt was made")
    for attempt in range(1, ATTEMPTS + 1):
        try:
            answer = parse_translation(await translate(messages), sent)
        except (TranslationError, JudgeError) as exc:
            failure = exc if isinstance(exc, TranslationError) else TranslationError(str(exc))
            log.warning("translation attempt %d failed (%s)", attempt, type(exc).__name__)
            continue
        return localized_fields(result, {key: masker.unmask(text) for key, text in answer.items()})
    raise failure
