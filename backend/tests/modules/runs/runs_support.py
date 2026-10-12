"""Helpers for the runs tests: runnable scenarios, and drivers that never contact a provider."""

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from voice_eval.runner.events import EventSink, RunEvent

AGENT = {
    "name": "Vivi dev",
    "context": "Answers balance questions for retail customers.",
    "baseUrl": "wss://agents.example.com",
    "channelId": "channel-123",
    "userId": "probe-user",
}
OPENAI = {"kind": "openai", "config": {}, "secrets": {"apiKey": "sk-proj-abcdefghijklmnop"}}
AZURE_TTS_ONLY = {
    "kind": "azure_openai",
    "config": {
        "endpoint": "https://res.openai.azure.com",
        "apiVersion": "2025-03-01-preview",
        "ttsDeployment": "my-tts",
    },
    "secrets": {"apiKey": "sk-azure-abcdefghijklmnop"},
}


def scenario_body(agent_id: str, name: str, **overrides: Any) -> dict[str, Any]:
    return {
        "agentId": agent_id,
        "name": name,
        "persona": {"name": "Lucía", "locale": "es-MX", "temperament": "hurried"},
        "goal": "Learn the current account balance.",
        "facts": [{"key": "account_number", "value": "123-456"}],
        "criteria": [
            {
                "text": "Agent states the balance",
                "kind": "must",
                "source": "transcript",
                "weight": 100,
            }
        ],
        "endConditions": {"maxDurationS": 60, "maxSilenceS": 10, "hangUpWhen": "goal_or_goodbye"},
        **overrides,
    }


class Factory:
    def __init__(self, client) -> None:
        self.client = client
        self._agent: str | None = None
        self._openai: str | None = None

    async def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = await self.client.post(path, json=body)
        assert response.status_code == 201, response.text
        return response.json()

    async def agent(self) -> str:
        if self._agent is None:
            self._agent = (await self.post("/api/agents", AGENT))["id"]
        return self._agent

    async def openai(self) -> str:
        if self._openai is None:
            body = {"name": "OpenAI", **OPENAI}
            self._openai = (await self.post("/api/connections", body))["id"]
        return self._openai

    async def scenario(self, name: str = "Balance", **overrides: Any) -> dict[str, Any]:
        if "ttsConnectionId" not in overrides:
            overrides["ttsConnectionId"] = await self.openai()
        return await self.post(
            "/api/scenarios", scenario_body(await self.agent(), name, **overrides)
        )


def summary_for(status: str = "completed", reason: str = "caller_hung_up") -> dict[str, Any]:
    return {
        "status": status,
        "reason": reason,
        "duration_ms": 1234.5,
        "caller_turns": 1,
        "agent_turns": 2,
        "latencies_ms": [420.0],
        "turns": [],
        "warnings": [],
    }


def write_fake_artifacts(out: Path, summary: dict[str, Any]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rows = [{"role": "agent", "text": "hello", "start_ms": 0.0, "end_ms": 400.0}]
    (out / "transcript.json").write_text(json.dumps(rows))
    (out / "summary.json").write_text(json.dumps(summary))
    (out / "agent.wav").write_bytes(b"RIFF....WAVEfake")


class BlockingDrive:
    """A fake driver: reports the session as running, then waits for `release` (or cancel).

    Writes `summary.json` and a transcript like the real runner, so the API can read them back.
    """

    def __init__(self) -> None:
        self.release = asyncio.Event()
        self.started: list[str] = []
        self.active = 0
        self.max_active = 0
        self.result = summary_for()

    async def __call__(self, job, sink: EventSink) -> dict[str, Any]:
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.started.append(str(job.run_id))
        out: Path = job.out_dir
        try:
            await sink.emit(RunEvent("protocol_detected", 1.0, {"protocol": "live"}))
            await self.release.wait()
            write_fake_artifacts(out, self.result)
            return self.result
        finally:
            self.active -= 1


async def wait_for(predicate, within_s: float = 10.0) -> None:
    """Poll `await predicate()` (an API read) until it holds."""
    async with asyncio.timeout(within_s):
        while not await predicate():  # noqa: ASYNC110 - the state lives behind the API
            await asyncio.sleep(0.02)


class ScriptedDrive:
    """A fake driver for the live stream: emits `before`, waits for `go`, emits `after`, ends.

    Each item is a `RunEvent`; the summary and artifacts are written like the real runner's.
    """

    def __init__(self, before: list[RunEvent], after: list[RunEvent]) -> None:
        self.before = before
        self.after = after
        self.go = asyncio.Event()
        self.result = summary_for()

    async def __call__(self, job, sink: EventSink) -> dict[str, Any]:
        await sink.emit(RunEvent("protocol_detected", 1.0, {"protocol": "live"}))
        for event in self.before:
            await sink.emit(event)
        await self.go.wait()
        for event in self.after:
            await sink.emit(event)
        write_fake_artifacts(job.out_dir, self.result)
        return self.result


async def insert_run(
    sessionmaker,
    *,
    status: str = "completed",
    artifacts_dir: Path | None = None,
    started_at: datetime | None = None,
    scenario_id: uuid.UUID | None = None,
    summary: dict[str, Any] | None = None,
) -> uuid.UUID:
    """A run written straight to the database (in its own batch), never driven."""
    from voice_eval.modules.runs.models import RunBatchRecord, RunRecord

    run_id, batch_id = uuid.uuid4(), uuid.uuid4()
    started = started_at or datetime(2026, 10, 10, 12, 0, tzinfo=UTC)
    active = status in {"queued", "connecting", "running"}
    async with sessionmaker() as db:
        db.add(RunBatchRecord(id=batch_id, concurrency=1, status="completed", total_runs=1))
        await db.flush()
        db.add(
            RunRecord(
                id=run_id,
                batch_id=batch_id,
                position=0,
                scenario_id=scenario_id,
                thread_id=f"thread-{str(run_id)[:8]}",
                status=status,
                snapshot={
                    "scenario": {"id": str(scenario_id or uuid.uuid4()), "name": "Balance"},
                    "agent": {"id": str(uuid.uuid4()), "name": "Vivi"},
                },
                summary=summary,
                artifacts_dir=str(artifacts_dir) if artifacts_dir else None,
                started_at=started,
                ended_at=None if active else started + timedelta(minutes=2),
            )
        )
        await db.commit()
    return run_id
