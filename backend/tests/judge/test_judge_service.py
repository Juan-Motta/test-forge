"""judge_run end to end against a scripted model: prompt in, scored result and brief out."""

import pytest
from judge_support import MUST_ID, SHOULD_ID, SNAPSHOT, SUMMARY, TRACE_ID, TRANSCRIPT, answer
from judge_support import verdict as v

from voice_eval.judge.domain import JudgeError
from voice_eval.judge.service import judge_run
from voice_eval.providers.langfuse_traces import digest_observations


class ScriptedModel:
    def __init__(self, reply) -> None:
        self.reply = reply
        self.messages: list[list[dict]] = []

    async def judge(self, messages):
        self.messages.append(messages)
        if isinstance(self.reply, BaseException):
            raise self.reply
        return self.reply


async def run(model, *, digest=None, note="the agent has no Langfuse connection", snapshot=None):
    return await judge_run(
        model,
        snapshot=snapshot or SNAPSHOT,
        transcript=TRANSCRIPT,
        summary=SUMMARY,
        trace_digest=digest,
        trace_note=note,
        run_id="run-1",
        thread_id="thread-1",
        model_name="gpt-6-luna",
    )


async def test_scores_the_answer_and_writes_the_brief():
    model = ScriptedModel(
        answer(v(MUST_ID, "fail", 20), v(SHOULD_ID, "pass", 90), v(TRACE_ID, "not_observable", 0))
    )
    result = await run(model)
    assert result.overall_score == 46  # (20*50 + 90*30) / 80 = 46.25
    assert result.must_failed is True
    assert result.observable_weight == 80
    assert result.model == "gpt-6-luna"
    assert result.trace_stats is None
    assert result.trace_note == "the agent has no Langfuse connection"
    assert "run-1" in result.brief and "thread-1" in result.brief
    (messages,) = model.messages
    assert "Traces unavailable" in messages[1]["content"]
    dumped = result.model_dump(mode="json", by_alias=True)
    assert {"overallScore", "mustFailed", "observableWeight", "traceStats"} <= set(dumped)
    assert dumped["criteria"][0]["criterionId"] == MUST_ID


async def test_trace_stats_come_from_the_digest():
    digest = digest_observations(
        [{"id": "o1", "traceId": "t1", "type": "GENERATION", "name": "llm", "model": "m",
          "startTime": "2026-10-01T00:00:01Z", "endTime": "2026-10-01T00:00:02Z"}],
        origin=None,
    )  # fmt: skip
    model = ScriptedModel(answer(v(MUST_ID), v(SHOULD_ID), v(TRACE_ID)))
    result = await run(model, digest=digest, note=None)
    assert result.trace_stats["observationCount"] == 1
    assert result.overall_score == 90
    assert '"ref":"R1"' in model.messages[0][1]["content"]


async def test_model_failures_propagate_as_judge_errors():
    with pytest.raises(JudgeError, match="unavailable"):
        await run(ScriptedModel(JudgeError("judge model unavailable (APITimeoutError)")))


async def test_a_malformed_answer_is_a_judge_error():
    with pytest.raises(JudgeError, match="malformed"):
        await run(ScriptedModel({"summary": "only this"}))


async def test_a_run_without_criteria_cannot_be_judged():
    snapshot = {**SNAPSHOT, "scenario": {**SNAPSHOT["scenario"], "criteria": []}}
    model = ScriptedModel(answer())
    with pytest.raises(JudgeError, match="no criteria"):
        await run(model, snapshot=snapshot)
    assert model.messages == []
