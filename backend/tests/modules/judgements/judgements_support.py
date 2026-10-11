"""Helpers for the judgement tests: finished runs written straight to the database, a fake
clock, a scripted Langfuse reader and a fake judge model. Nothing contacts a provider."""

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from voice_eval.judge.domain import JudgeError
from voice_eval.modules.judgements.models import RunJudgementRecord
from voice_eval.modules.runs.models import RunBatchRecord, RunRecord

MUST_ID = "11111111-1111-4111-8111-111111111111"
TRACE_ID = "22222222-2222-4222-8222-222222222222"
EVALUATOR_ID = "33333333-3333-4333-8333-333333333333"
LANGFUSE_ID = "44444444-4444-4444-8444-444444444444"
STARTED = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)
ENDED = STARTED + timedelta(minutes=2)

CRITERIA = [
    {"id": MUST_ID, "text": "States the balance", "kind": "must", "source": "transcript",
     "weight": 60},
    {"id": TRACE_ID, "text": "Calls the balance tool once", "kind": "should", "source": "trace",
     "weight": 40},
]  # fmt: skip

TRANSCRIPT = [
    {"role": "agent", "text": "Hello, how can I help?", "start_ms": 0.0, "end_ms": 900.0},
    {"role": "caller", "text": "My balance, please.", "start_ms": 1500.0, "end_ms": 2500.0},
    {"role": "agent", "text": "It is 120 dollars.", "start_ms": 3400.0, "end_ms": 5000.0,
     "latency_ms": 900.0},
]  # fmt: skip

SUMMARY = {
    "status": "completed",
    "reason": "caller_hung_up",
    "duration_ms": 6000.0,
    "caller_turns": 1,
    "agent_turns": 2,
    "latencies_ms": [900.0],
    "turns": [],
    "warnings": [],
}


def snapshot(*, langfuse: str | None = LANGFUSE_ID, legacy: bool = False) -> dict[str, Any]:
    """A run snapshot; `legacy` leaves out the agent's Langfuse connection (older runs)."""
    agent: dict[str, Any] = {"id": str(uuid.uuid4()), "name": "Vivi", "protocol": "vivi_live"}
    if not legacy:
        agent["langfuse_connection_id"] = langfuse
    return {
        "scenario": {"id": str(uuid.uuid4()), "name": "Balance", "goal": "Learn the balance.",
                     "criteria": CRITERIA},
        "agent": agent,
        "connections": {
            "tts": {"id": str(uuid.uuid4()), "name": "TTS"},
            "evaluator": {"id": EVALUATOR_ID, "name": "OpenAI", "chat_model": "gpt-6-luna"},
        },
    }  # fmt: skip


def write_artifacts(out: Path, summary: dict[str, Any] | None = None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "transcript.json").write_text(json.dumps(TRANSCRIPT))
    (out / "summary.json").write_text(json.dumps(summary or SUMMARY))


async def insert_run(
    sessionmaker,
    *,
    data: dict[str, Any] | None = None,
    status: str = "completed",
    artifacts_dir: Path | None = None,
    agent_id: uuid.UUID | None = None,
    summary: dict[str, Any] | None = None,
) -> uuid.UUID:
    """A finished run (in its own batch) with `thread_id` = "thread-<run id prefix>"."""
    run_id, batch_id = uuid.uuid4(), uuid.uuid4()
    active = status in {"queued", "connecting", "running"}
    async with sessionmaker() as db:
        db.add(RunBatchRecord(id=batch_id, concurrency=1, status="completed", total_runs=1))
        await db.flush()
        db.add(
            RunRecord(
                id=run_id,
                batch_id=batch_id,
                position=0,
                agent_id=agent_id,
                thread_id=f"thread-{str(run_id)[:8]}",
                status=status,
                snapshot=data or snapshot(),
                summary=summary,
                artifacts_dir=str(artifacts_dir) if artifacts_dir else None,
                started_at=STARTED,
                ended_at=None if active else ENDED,
            )
        )
        await db.commit()
    return run_id


async def judgement_row(sessionmaker, run_id: uuid.UUID) -> RunJudgementRecord | None:
    async with sessionmaker() as db:
        return await db.get(RunJudgementRecord, run_id, populate_existing=True)


class FakeClock:
    """`now()` starts at `start`; `sleep(s)` advances it instantly and records the wait."""

    def __init__(self, start: datetime) -> None:
        self.moment = start
        self.sleeps: list[float] = []

    def now(self) -> datetime:
        return self.moment

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.moment += timedelta(seconds=seconds)
        await asyncio.sleep(0)


def observation(index: int) -> dict[str, Any]:
    start = STARTED + timedelta(seconds=10 + index)
    return {
        "id": f"obs-{index}",
        "traceId": "trace-1",
        "type": "GENERATION",
        "name": f"llm-{index}",
        "startTime": start.isoformat(),
        "endTime": (start + timedelta(milliseconds=800)).isoformat(),
        "providedModelName": "gpt-x",
    }


class ScriptedReader:
    """Answers each `fetch_session` with the next scripted item (the last one repeats); an
    exception item is raised. `gate`, when set, is awaited before every answer."""

    def __init__(self, *script: Any) -> None:
        self.script = list(script) or [[]]
        self.calls: list[dict[str, Any]] = []
        self.gate: asyncio.Event | None = None

    async def fetch_session(self, session_id: str, *, start: datetime, end: datetime) -> list:
        self.calls.append({"session_id": session_id, "start": start, "end": end})
        if self.gate is not None:
            await self.gate.wait()
        item = self.script[min(len(self.calls), len(self.script)) - 1]
        if isinstance(item, Exception):
            raise item
        return list(item)


class FakeJudgeModel:
    """Passes the transcript criterion and fails the trace one; or raises `error`."""

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.messages: list[list[dict[str, Any]]] = []
        self.gate: asyncio.Event | None = None

    async def judge(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        self.messages.append(messages)
        if self.gate is not None:
            await self.gate.wait()
        if self.error is not None:
            raise self.error
        return {
            "summary": "The agent stated the balance.",
            "criteria": [
                verdict(MUST_ID, "pass", 90, "transcript"),
                verdict(TRACE_ID, "fail", 40, "trace"),
            ],
            "suggestions": [
                {"title": "Cache the lookup", "detail": "Reply faster.", "area": "latency",
                 "priority": "low", "evidenceRefs": ["T1"]},
            ],
            "strengths": ["Clear answer"],
        }  # fmt: skip


def verdict(criterion_id: str, verdict: str, score: int, source: str) -> dict[str, Any]:
    return {
        "criterionId": criterion_id,
        "verdict": verdict,
        "score": score,
        "rationale": f"rationale for {criterion_id[:4]}",
        "evidence": [{"source": source, "ref": "A2", "quote": "It is 120 dollars."}],
    }


MALFORMED = JudgeError("malformed judge answer (does not match the judgement schema)")


async def settled(coordinator, run_id: uuid.UUID, within_s: float = 10.0) -> None:
    """Wait until the coordinator has no task left for the run."""
    async with asyncio.timeout(within_s):
        while coordinator.is_active(run_id):  # noqa: ASYNC110 - the task lives in the coordinator
            await asyncio.sleep(0.01)
