"""judge_run end to end against a scripted model: prompt in, scored result and brief out.

Every judgement asks the model `JUDGE_SAMPLES` times on the same messages and aggregates the
samples per criterion (median band), so a scripted model answers each call in turn.
"""

import logging

import pytest
from judge_support import MUST_ID, SHOULD_ID, SNAPSHOT, SUMMARY, TRACE_ID, TRANSCRIPT, answer
from judge_support import verdict as v

from voice_eval.judge.domain import JudgeError
from voice_eval.judge.service import JUDGE_SAMPLES, judge_run
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


class SequenceModel:
    """Answers the n-th call with the n-th reply (cycling); an exception reply is raised."""

    def __init__(self, *replies) -> None:
        self.replies = list(replies)
        self.messages: list[list[dict]] = []

    async def judge(self, messages):
        reply = self.replies[len(self.messages) % len(self.replies)]
        self.messages.append(messages)
        if isinstance(reply, BaseException):
            raise reply
        return reply


async def run(
    model,
    *,
    digest=None,
    note="the agent has no Langfuse connection",
    snapshot=None,
    summary=None,
):
    return await judge_run(
        model,
        snapshot=snapshot or SNAPSHOT,
        transcript=TRANSCRIPT,
        summary=SUMMARY if summary is None else summary,
        trace_digest=digest,
        trace_note=note,
        run_id="run-1",
        thread_id="thread-1",
        model_name="gpt-6-luna",
    )


async def test_scores_the_answer_and_writes_the_brief():
    model = ScriptedModel(
        answer(v(MUST_ID, 1), v(SHOULD_ID, 4, tags=("slow_response",)), v(TRACE_ID, 5))
    )
    result = await run(model)
    assert result.overall_score == 49  # (25*50 + 90*30) / 80 = 49.4; the trace one is gated
    assert result.must_failed is True
    assert result.observable_weight == 80
    assert result.model == "gpt-6-luna"
    assert result.trace_stats is None
    assert result.trace_note == "the agent has no Langfuse connection"
    assert "run-1" in result.brief and "thread-1" in result.brief
    assert len(model.messages) == JUDGE_SAMPLES == 3
    messages = model.messages[0]
    assert all(sample == messages for sample in model.messages)  # identical evidence
    assert "Traces unavailable" in messages[1]["content"]
    dumped = result.model_dump(mode="json", by_alias=True)
    assert dumped["version"] == 2
    assert dumped["samples"] == 3
    assert dumped["failureTags"] == {"slow_response": 1}
    assert {"overallScore", "mustFailed", "observableWeight", "traceStats"} <= set(dumped)
    criteria = {c["criterionId"]: c for c in dumped["criteria"]}
    assert criteria[MUST_ID] | {"evidence": None} == {
        "criterionId": MUST_ID,
        "text": "Confirms the booking",
        "kind": "must",
        "source": "transcript",
        "weight": 50,
        "verdict": "fail",
        "score": 25,
        "band": 1,
        "failureTags": [],
        "unobservableReason": None,
        "capped": False,
        "rationale": f"reasoning for {MUST_ID[:4]}",
        "evidence": None,
        "sampleBands": [1, 1, 1],
    }
    trace = criteria[TRACE_ID]
    assert (trace["verdict"], trace["band"], trace["unobservableReason"]) == (
        "not_observable",
        None,
        "traces_unavailable",
    )
    assert trace["sampleBands"] == [None, None, None]


async def test_a_timing_criterion_without_turn_timings_is_gated():
    model = ScriptedModel(answer(v(MUST_ID), v(SHOULD_ID, 1), v(TRACE_ID)))
    result = await run(model, summary={"status": "completed"})
    timing = next(c for c in result.criteria if c.criterion_id == SHOULD_ID)
    assert (timing.verdict, timing.unobservable_reason) == ("not_observable", "no_timing_data")
    assert result.overall_score == 100 and result.observable_weight == 50


async def test_trace_stats_come_from_the_digest():
    digest = digest_observations(
        [{"id": "o1", "traceId": "t1", "type": "GENERATION", "name": "llm", "model": "m",
          "startTime": "2026-10-01T00:00:01Z", "endTime": "2026-10-01T00:00:02Z"}],
        origin=None,
    )  # fmt: skip
    model = ScriptedModel(answer(v(MUST_ID, 4), v(SHOULD_ID, 4), v(TRACE_ID, 4)))
    result = await run(model, digest=digest, note=None)
    assert result.trace_stats["observationCount"] == 1
    assert result.overall_score == 90
    assert all(c.verdict == "pass" for c in result.criteria)
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


def _sample(must_band, *, summary="s", observable=True, tags=(), reasoning=None, quote=None):
    must = v(MUST_ID, must_band, observable=observable, tags=tags)
    if reasoning is not None:
        must["reasoning"] = reasoning
    if quote is not None:
        must["evidence"] = [{"source": "transcript", "ref": "A2", "quote": quote}]
    return answer(must, v(SHOULD_ID, 4), v(TRACE_ID, 5), summary=summary)


async def test_the_band_is_the_median_of_the_samples_with_that_samples_reasoning():
    model = SequenceModel(
        _sample(1, reasoning="one", quote="q1"),
        _sample(5, reasoning="five", quote="q5"),
        _sample(4, reasoning="four", quote="q4", tags=("incomplete_task",)),
    )
    result = await run(model)
    must = next(c for c in result.criteria if c.criterion_id == MUST_ID)
    assert (must.band, must.verdict, must.score) == (4, "pass", 90)
    assert must.sample_bands == [1, 5, 4]
    assert must.rationale == "four" and must.evidence[0].quote == "q4"
    assert must.failure_tags == ["incomplete_task"]
    assert result.samples == 3
    assert result.overall_score == 90  # recomputed from the aggregated bands (4 and 4)
    assert result.failure_tags == {"incomplete_task": 1}


async def test_an_even_number_of_observable_samples_takes_the_lower_median():
    model = SequenceModel(_sample(3), _sample(5), _sample(5, observable=False))
    must = next(c for c in (await run(model)).criteria if c.criterion_id == MUST_ID)
    assert (must.band, must.sample_bands) == (3, [3, 5, None])


async def test_cap_and_tags_follow_the_sample_whose_band_is_the_median():
    model = SequenceModel(
        _sample(5, tags=("fabricated_information",), reasoning="capped"),  # capped to 2
        _sample(5, reasoning="clean"),
        _sample(2, tags=("missing_information_request",), reasoning="two"),
    )
    must = next(c for c in (await run(model)).criteria if c.criterion_id == MUST_ID)
    assert must.sample_bands == [2, 5, 2]
    assert (must.band, must.capped, must.rationale) == (2, True, "capped")
    assert must.failure_tags == ["fabricated_information"]


async def test_most_samples_unobservable_make_the_criterion_unobservable():
    model = SequenceModel(_sample(5, observable=False), _sample(4), _sample(5, observable=False))
    must = next(c for c in (await run(model)).criteria if c.criterion_id == MUST_ID)
    assert (must.verdict, must.band, must.score) == ("not_observable", None, None)
    assert must.unobservable_reason == "judge_marked_unobservable"
    assert must.sample_bands == [None, 4, None]


async def test_run_text_comes_from_the_sample_with_the_median_overall_score():
    model = SequenceModel(
        _sample(1, summary="low"), _sample(5, summary="high"), _sample(4, summary="middle")
    )
    result = await run(model)
    assert result.summary == "middle"
    assert result.overall_score == 90


async def test_median_score_ties_take_the_first_such_sample():
    model = SequenceModel(
        _sample(4, summary="first"), _sample(4, summary="second"), _sample(1, summary="low")
    )
    assert (await run(model)).summary == "first"


async def test_one_failed_sample_is_skipped_and_logged_without_its_text(caplog):
    secret = JudgeError("judge model unavailable (sk-should-not-be-logged)")
    model = SequenceModel(_sample(3), secret, _sample(5))
    with caplog.at_level(logging.WARNING, logger="voice_eval.judge.service"):
        result = await run(model)
    must = next(c for c in result.criteria if c.criterion_id == MUST_ID)
    assert (result.samples, must.sample_bands, must.band) == (2, [3, 5], 3)
    assert "sample 2 of 3" in caplog.text and "JudgeError" in caplog.text
    assert "sk-should-not-be-logged" not in caplog.text


async def test_a_malformed_sample_is_skipped_too():
    model = SequenceModel(_sample(4), {"summary": "only this"}, _sample(4))
    assert (await run(model)).samples == 2


async def test_fewer_than_two_successful_samples_is_a_judge_error():
    error = JudgeError("judge model unavailable (APITimeoutError)")
    with pytest.raises(JudgeError, match="unavailable"):
        await run(SequenceModel(_sample(4), error, error))


async def test_an_unexpected_sample_error_propagates():
    with pytest.raises(RuntimeError):
        await run(SequenceModel(_sample(4), RuntimeError("bug"), _sample(4)))
