"""Judgements domain: one judgement per run and its state machine.

A judgement moves `pending` -> `collecting_traces` (only when the agent has a Langfuse
connection) -> `judging` -> `completed` or `failed`. Re-judging resets it to `pending` with the
next `attempt`; every write of a judging task is guarded by its attempt, so a superseded task
never overwrites a newer one.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal


class JudgementStatus(StrEnum):
    PENDING = "pending"
    COLLECTING_TRACES = "collecting_traces"
    JUDGING = "judging"
    COMPLETED = "completed"
    FAILED = "failed"


ACTIVE_JUDGEMENT_STATUSES = frozenset(
    {JudgementStatus.PENDING, JudgementStatus.COLLECTING_TRACES, JudgementStatus.JUDGING}
)
TERMINAL_JUDGEMENT_STATUSES = frozenset({JudgementStatus.COMPLETED, JudgementStatus.FAILED})

# A completed judgement's translated version, per language: `none` (never asked: judgements
# made before translations), `pending`, `ready` or `failed` (its `error` says why).
TranslationStatus = Literal["none", "pending", "ready", "failed"]
TRANSLATION_STATUSES = ("pending", "ready", "failed")


@dataclass(frozen=True)
class Judgement:
    run_id: uuid.UUID
    status: JudgementStatus
    result: dict[str, Any] | None  # `JudgeResult` dumped with camelCase keys
    trace_stats: dict[str, Any] | None  # digest stats, camelCase keys
    trace_note: str | None  # why trace evidence is missing or partial
    error: str | None
    model: str | None
    attempt: int
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    usage: dict[str, Any] | None = None  # the judge's usage over every attempt (`ports.usage`)
    # {language: {"status", "error", "fields"}}; see `translation`
    translations: dict[str, Any] | None = None

    @property
    def active(self) -> bool:
        return self.status in ACTIVE_JUDGEMENT_STATUSES

    def translation(self, language: str) -> dict[str, Any]:
        """The stored translation entry for `language`: `{"status": "none"|"pending"|"ready"|
        "failed", "error": str | None, "fields": {...}}` (`fields` only when ready)."""
        entry = (self.translations or {}).get(language)
        if not isinstance(entry, dict) or entry.get("status") not in TRANSLATION_STATUSES:
            return {"status": "none", "error": None}
        return entry


class JudgementInProgress(Exception):
    """The run's judgement is still pending, collecting traces or judging."""


class JudgementNotTranslatable(Exception):
    """The run has no completed judgement to translate."""


class JudgementFailed(Exception):
    """The judgement cannot complete; the message is safe to store and show."""
