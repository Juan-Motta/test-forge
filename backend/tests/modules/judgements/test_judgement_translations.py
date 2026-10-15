"""Spanish versions of judgements: made after each judgement, served with `?lang=es`, made on
demand for old judgements, and billed with the judge.

Runs are written straight to the database and judged with the fakes of `harness` (the fake
judge model translates by prefixing "ES: "); nothing contacts a provider.
"""

import asyncio
import json
import uuid

from judgements_support import (
    MALFORMED,
    FakeJudgeModel,
    insert_run,
    judgement_row,
    settled,
    snapshot,
    spanish,
)
from sqlalchemy import update

from voice_eval.modules.judgements.models import RunJudgementRecord
from voice_eval.ports.usage import UsageMeter

QUOTE = "It is 120 dollars."


async def judged(app) -> uuid.UUID:
    run_id = await insert_run(app.state.sessionmaker, data=snapshot(langfuse=None))
    coordinator = app.state.judgements
    await coordinator.schedule(run_id)
    await settled(coordinator, run_id)
    return run_id


def _sent(messages) -> str:
    return messages[-1]["content"]


async def test_a_spanish_version_is_stored_after_each_judgement(app, harness):
    run_id = await judged(app)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert row.status == "completed"
    entry = row.translations["es"]
    assert entry["status"] == "ready" and entry["error"] is None
    fields = entry["fields"]
    assert fields["summary"] == "ES: The agent stated the balance."
    assert fields["strengths"] == ["ES: Clear answer"]
    assert fields["suggestions"] == [
        {"title": "ES: Cache the lookup", "detail": "ES: Reply faster."}
    ]
    assert [c["criterionId"] for c in fields["criteria"]] == [
        c["criterionId"] for c in row.result["criteria"]
    ]
    assert fields["brief"].startswith("ES: # Voice agent review")
    assert f'"{QUOTE}"' in fields["brief"]  # restored verbatim
    assert row.result["summary"] == "The agent stated the balance."  # English kept as is

    (messages,) = harness.model.translated
    sent = _sent(messages)
    for protected in (QUOTE, "States the balance", "Vivi", str(run_id)):
        assert protected not in sent  # never sent for translation


async def test_a_partial_answer_is_retried_then_the_translation_fails_alone(app, harness):
    def partial(messages):
        answer = spanish(messages)
        answer["items"] = [item for item in answer["items"] if item["key"] != "brief"]
        return answer

    harness.model.translations = [partial]
    run_id = await judged(app)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert row.status == "completed" and row.error is None  # the judgement stands
    assert row.translations["es"]["status"] == "failed"
    assert "incomplete translation" in row.translations["es"]["error"]
    assert "fields" not in row.translations["es"]
    assert len(harness.model.translated) == 2


async def test_without_a_usable_model_the_translation_fails_with_a_note(app, harness):
    coordinator = app.state.judgements
    built = 0

    async def build_judge(db, connection_id):
        nonlocal built
        built += 1
        if built > 1:  # the judge was built; the translation's model cannot be
            raise RuntimeError("gone")
        return harness.model

    coordinator.build_judge = build_judge
    run_id = await judged(app)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert row.status == "completed"
    assert row.translations["es"]["status"] == "failed"
    assert row.translations["es"]["error"].startswith("no model to translate with")


class MeteredModel(FakeJudgeModel):
    def __init__(self) -> None:
        super().__init__()
        self.usage = UsageMeter()

    async def judge(self, messages):
        self.usage.add("gpt-6-luna", text_in=100, text_out=10)
        return await super().judge(messages)

    async def translate(self, messages):
        self.usage.add("gpt-6-luna", text_in=40, text_out=20)
        return await super().translate(messages)


async def test_the_translation_usage_is_added_to_the_judge_usage(app, harness, user_client):
    harness.model = MeteredModel()  # the same instance judges and translates: no double count
    run_id = await judged(app)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert row.result["usage"] == {"by_model": {"gpt-6-luna": {"text_in": 300, "text_out": 30}}}
    assert row.usage == {"by_model": {"gpt-6-luna": {"text_in": 340, "text_out": 50}}}
    cost = (await user_client.get(f"/api/runs/{run_id}")).json()["cost"]
    assert cost["judgeUsd"] is not None


async def test_lang_es_serves_the_spanish_texts(app, user_client, harness):
    run_id = await judged(app)
    english = (await user_client.get(f"/api/runs/{run_id}/judgement")).json()
    assert (english["language"], english["translationStatus"]) == ("en", "ready")
    assert english["result"]["summary"] == "The agent stated the balance."

    body = (await user_client.get(f"/api/runs/{run_id}/judgement?lang=es")).json()
    assert (body["language"], body["translationStatus"], body["translationError"]) == (
        "es",
        "ready",
        None,
    )
    result = body["result"]
    assert result["summary"] == "ES: The agent stated the balance."
    assert result["criteria"][0]["rationale"].startswith("ES: ")
    assert result["criteria"][0]["text"] == english["result"]["criteria"][0]["text"]
    assert result["criteria"][0]["evidence"] == english["result"]["criteria"][0]["evidence"]
    assert result["suggestions"][0]["evidenceRefs"] == ["T1"]
    assert result["overallScore"] == english["result"]["overallScore"]
    assert "translations" not in result

    bad = await user_client.get(f"/api/runs/{run_id}/judgement?lang=fr")
    assert bad.status_code == 422


async def test_lang_es_falls_back_to_english_until_ready(app, user_client, harness):
    harness.model.translate_gate = asyncio.Event()
    run_id = await insert_run(app.state.sessionmaker, data=snapshot(langfuse=None))
    await app.state.judgements.schedule(run_id)
    async with asyncio.timeout(5):
        while not harness.model.translated:  # noqa: ASYNC110
            await asyncio.sleep(0.01)
    body = (await user_client.get(f"/api/runs/{run_id}/judgement?lang=es")).json()
    assert (body["status"], body["language"], body["translationStatus"]) == (
        "completed",
        "en",
        "pending",
    )
    assert body["result"]["summary"] == "The agent stated the balance."
    harness.model.translate_gate.set()
    await settled(app.state.judgements, run_id)


async def test_old_judgements_are_translated_on_demand(app, user_client, harness):
    run_id = await judged(app)
    async with app.state.sessionmaker() as db:  # as stored before translations existed
        await db.execute(
            update(RunJudgementRecord)
            .where(RunJudgementRecord.run_id == run_id)
            .values(translations=None)
        )
        await db.commit()
    harness.model.translated.clear()
    before = (await user_client.get(f"/api/runs/{run_id}/judgement?lang=es")).json()
    assert (before["language"], before["translationStatus"]) == ("en", "none")

    started = await user_client.post(f"/api/runs/{run_id}/judgement/translations?lang=es")
    assert started.status_code == 202, started.text
    assert started.json()["translationStatus"] == "pending"
    await settled(app.state.judgements, run_id)
    body = (await user_client.get(f"/api/runs/{run_id}/judgement?lang=es")).json()
    assert (body["language"], body["translationStatus"]) == ("es", "ready")
    assert len(harness.model.translated) == 1

    again = await user_client.post(f"/api/runs/{run_id}/judgement/translations")
    assert again.status_code == 202
    assert again.json()["translationStatus"] == "ready"
    await settled(app.state.judgements, run_id)
    assert len(harness.model.translated) == 1  # idempotent: nothing is paid twice


async def test_a_failed_translation_can_be_asked_again(app, user_client, harness):
    harness.model.translations = [MALFORMED]
    run_id = await judged(app)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert row.translations["es"]["status"] == "failed"

    harness.model.translations = [spanish]
    response = await user_client.post(f"/api/runs/{run_id}/judgement/translations?lang=es")
    assert response.status_code == 202
    await settled(app.state.judgements, run_id)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert row.translations["es"]["status"] == "ready"


async def test_on_demand_translation_requires_authentication(client):
    assert (
        await client.post(f"/api/runs/{uuid.uuid4()}/judgement/translations")
    ).status_code == 401


async def test_on_demand_translation_conflicts_and_errors(app, user_client, harness):
    url = f"/api/runs/{uuid.uuid4()}/judgement/translations"
    assert (await user_client.post(url)).status_code == 404

    run_id = await insert_run(app.state.sessionmaker, data=snapshot(langfuse=None))
    url = f"/api/runs/{run_id}/judgement/translations"
    none = await user_client.post(url)
    assert none.status_code == 409
    assert none.json()["detail"] == "No completed judgement to translate"

    harness.model.gate = asyncio.Event()
    await app.state.judgements.schedule(run_id)
    busy = await user_client.post(url)
    assert busy.status_code == 409
    assert busy.json()["detail"] == "Judgement already in progress"
    harness.model.gate.set()
    await settled(app.state.judgements, run_id)

    assert (await user_client.post(f"{url}?lang=en")).status_code == 422


async def test_a_rejudge_drops_the_old_translation_and_makes_a_new_one(app, harness):
    run_id = await judged(app)
    coordinator = app.state.judgements
    harness.model.gate = asyncio.Event()
    await coordinator.rejudge(run_id)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert row.translations is None  # reset with the result
    harness.model.gate.set()
    await settled(coordinator, run_id)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert (row.attempt, row.translations["es"]["status"]) == (2, "ready")


async def test_a_translation_left_pending_is_resumed_at_startup(app, harness):
    run_id = await judged(app)
    async with app.state.sessionmaker() as db:
        await db.execute(
            update(RunJudgementRecord)
            .where(RunJudgementRecord.run_id == run_id)
            .values(translations={"es": {"status": "pending", "error": None}})
        )
        await db.commit()
    harness.model.translated.clear()
    await app.state.judgements.recover()
    await settled(app.state.judgements, run_id)
    row = await judgement_row(app.state.sessionmaker, run_id)
    assert row.translations["es"]["status"] == "ready"
    assert len(harness.model.translated) == 1
    assert json.loads(_sent(harness.model.translated[0]))["items"]
