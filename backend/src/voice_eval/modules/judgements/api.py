"""HTTP API of the judgements module: `/api/runs/{run_id}/judgement` (behind authentication).

The judging itself happens in the coordinator (`app.state.judgements`); this reads the stored
judgement and asks for a new one. The result is stored with camelCase keys and returned as is,
in English, or with its translated texts swapped in when asked for another language
(`?lang=es`) and that version is ready.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.judge.translation import Language, TranslatedLanguage, apply_translation
from voice_eval.modules.judgements import service
from voice_eval.modules.judgements.coordinator import JudgementCoordinator
from voice_eval.modules.judgements.domain import (
    Judgement,
    JudgementInProgress,
    JudgementNotTranslatable,
    JudgementStatus,
    TranslationStatus,
)
from voice_eval.modules.runs import service as runs
from voice_eval.modules.runs.api import CamelModel
from voice_eval.modules.runs.domain import Run, RunNotFound
from voice_eval.platform.db import get_db_session

Db = Annotated[AsyncSession, Depends(get_db_session)]


def coordinator(request: Request) -> JudgementCoordinator:
    return request.app.state.judgements


Coordinator = Annotated[JudgementCoordinator, Depends(coordinator)]
Lang = Annotated[
    Language,
    Query(description="Language of the result's texts: `en` (as judged) or `es` (translated)."),
]
TranslateLang = Annotated[
    TranslatedLanguage, Query(description="The language to translate the judgement into.")
]


class NoJudgementOut(CamelModel):
    status: Literal["none"] = "none"


class JudgementOut(CamelModel):
    status: JudgementStatus
    result: dict[str, Any] | None
    trace_stats: dict[str, Any] | None
    trace_note: str | None
    error: str | None
    model: str | None
    attempt: int
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    usage: dict[str, Any] | None  # the judge's token usage summed over every attempt
    language: Language  # the language of `result`'s texts
    # the asked language's version (the Spanish one when English is asked): `none` (never
    # made: older judgements), `pending`, `ready` or `failed` (`translationError` says why)
    translation_status: TranslationStatus
    translation_error: str | None

    @classmethod
    def of(cls, judgement: Judgement, lang: Language = "en") -> "JudgementOut":
        entry = judgement.translation("es" if lang == "en" else lang)
        result, language = judgement.result, "en"
        if lang != "en" and result is not None and entry["status"] == "ready":
            result, language = apply_translation(result, entry.get("fields") or {}), lang
        return cls(
            status=judgement.status,
            result=result,
            language=language,
            translation_status=entry["status"],
            translation_error=entry.get("error"),
            trace_stats=judgement.trace_stats,
            trace_note=judgement.trace_note,
            error=judgement.error,
            model=judgement.model,
            attempt=judgement.attempt,
            created_at=judgement.created_at,
            updated_at=judgement.updated_at,
            completed_at=judgement.completed_at,
            usage=judgement.usage,
        )


async def _run(db: AsyncSession, run_id: uuid.UUID) -> Run:
    try:
        return await runs.get_run(db, run_id)
    except RunNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found") from None


router = APIRouter(prefix="/runs", tags=["judgements"])


@router.get("/{run_id}/judgement", response_model=JudgementOut | NoJudgementOut)
async def get_judgement(
    run_id: uuid.UUID, db: Db, lang: Lang = "en"
) -> JudgementOut | NoJudgementOut:
    """The run's judgement, or `{"status": "none"}` when it was never judged.

    With `lang=es` the result's free texts (summary, rationales, suggestion titles and details,
    strengths, brief) are the Spanish version when it is ready (`language` says which texts
    came back, `translationStatus` the Spanish version's state); otherwise they stay English.
    Criterion texts, evidence quotes, refs, tags and numbers are never translated."""
    await _run(db, run_id)
    judgement = await service.get_judgement(db, run_id)
    return JudgementOut.of(judgement, lang) if judgement is not None else NoJudgementOut()


@router.post(
    "/{run_id}/judgement", response_model=JudgementOut, status_code=status.HTTP_202_ACCEPTED
)
async def rejudge(run_id: uuid.UUID, db: Db, judgements: Coordinator) -> JudgementOut:
    """Judge the run again, replacing the previous result. 409 while the run or a judgement of
    it is still in progress."""
    run = await _run(db, run_id)
    if not run.finished:
        raise HTTPException(status.HTTP_409_CONFLICT, "Run still in progress")
    try:
        judgement = await judgements.rejudge(run_id)
    except JudgementInProgress:
        raise HTTPException(status.HTTP_409_CONFLICT, "Judgement already in progress") from None
    return JudgementOut.of(judgement)


@router.post(
    "/{run_id}/judgement/translations",
    response_model=JudgementOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def translate(
    run_id: uuid.UUID, db: Db, judgements: Coordinator, lang: TranslateLang = "es"
) -> JudgementOut:
    """Make the `lang` version of the run's completed judgement (paid: one judge model call,
    added to the judge cost). Idempotent: a ready or in-progress version is returned as is,
    a missing or failed one is (re)started (`translationStatus: "pending"`). 409 while the run
    is being judged or when it has no completed judgement."""
    await _run(db, run_id)
    try:
        judgement = await judgements.translate(run_id, lang)
    except JudgementInProgress:
        raise HTTPException(status.HTTP_409_CONFLICT, "Judgement already in progress") from None
    except JudgementNotTranslatable:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "No completed judgement to translate"
        ) from None
    return JudgementOut.of(judgement, lang)
