"""Live stream of runs over WebSocket: auth, Origin, snapshot, ordered events, audio, backpressure.

The app is served by an in-process uvicorn on a free port; runs are driven by `ScriptedDrive`,
so no agent or provider is ever contacted.
"""

import asyncio
import json
import uuid

import pytest
import uvicorn
from runs_support import ScriptedDrive, wait_for
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from voice_eval.modules.runs.live import LiveHub, Subscriber
from voice_eval.runner.events import RunEvent

ORIGIN = "http://localhost:3000"  # the test settings' WEB_ORIGINS
AGENT_PCM = b"\x10\x00" * 240
CALLER_PCM = b"\x20\x00" * 240


@pytest.fixture
async def server(app):
    """The test app served over a real socket (WebSockets need one); yields its ws:// base."""
    config = uvicorn.Config(
        app, host="127.0.0.1", port=0, lifespan="off", ws="websockets-sansio", log_level="warning"
    )
    instance = uvicorn.Server(config)
    task = asyncio.create_task(instance.serve())
    async with asyncio.timeout(10):
        while not instance.started:  # noqa: ASYNC110 - uvicorn exposes only this flag
            await asyncio.sleep(0.01)
    port = instance.servers[0].sockets[0].getsockname()[1]
    yield f"ws://127.0.0.1:{port}"
    instance.should_exit = True
    await task


def cookie_of(client) -> str:
    return f"ve_session={client.cookies.get('ve_session')}"


async def close_code(url: str, headers: dict[str, str]) -> int | None:
    async with connect(url, additional_headers=headers) as ws:
        with pytest.raises(ConnectionClosed):
            await asyncio.wait_for(ws.recv(), 5)
        return ws.close_code


async def receive_all(ws) -> list[str | bytes]:
    """Every message until the server closes the stream."""
    messages: list[str | bytes] = []
    with pytest.raises(ConnectionClosed):
        while True:
            messages.append(await asyncio.wait_for(ws.recv(), 10))
    return messages


def decoded(messages):
    return [m if isinstance(m, bytes) else json.loads(m) for m in messages]


def kinds(messages) -> list[str]:
    return [f"audio:{m[0]}" if isinstance(m, bytes) else m["type"] for m in messages]


async def launch_one(user_client, factory, app, drive, *, repetitions=1) -> dict:
    app.state.runs.drive = drive
    scenario = await factory.scenario()
    response = await user_client.post(
        "/api/runs", json={"scenarioIds": [scenario["id"]], "repetitions": repetitions}
    )
    assert response.status_code == 201, response.text
    return response.json()


def status_is(user_client, run_id: str, status: str):
    async def check() -> bool:
        return (await user_client.get(f"/api/runs/{run_id}")).json()["status"] == status

    return check


async def test_requires_a_session_cookie(server, user_client):
    url = f"{server}/api/runs/{uuid.uuid4()}/live"
    assert await close_code(url, {"Origin": ORIGIN}) == 4401
    assert await close_code(url, {"Origin": ORIGIN, "Cookie": "ve_session=forged"}) == 4401


async def test_rejects_a_foreign_or_missing_origin(server, user_client):
    url = f"{server}/api/runs/{uuid.uuid4()}/live"
    cookie = cookie_of(user_client)
    assert await close_code(url, {"Origin": "https://evil.example", "Cookie": cookie}) == 4403
    assert await close_code(url, {"Cookie": cookie}) == 4403


async def test_an_api_key_header_authenticates_without_origin(server, user_client):
    created = await user_client.post("/api/api-keys", json={"name": "ws"})
    assert created.status_code == 201, created.text
    key = created.json()["key"]
    url = f"{server}/api/runs/{uuid.uuid4()}/live"
    # authenticated (the run is unknown, so 4404), with or without an Origin
    assert await close_code(url, {"Authorization": f"Bearer {key}"}) == 4404
    assert await close_code(url, {"Authorization": f"Bearer {key}", "Origin": ORIGIN}) == 4404
    assert await close_code(url, {"Authorization": "Bearer ve_aaaaaaaa_forged"}) == 4401
    await user_client.delete(f"/api/api-keys/{created.json()['id']}")
    assert await close_code(url, {"Authorization": f"Bearer {key}"}) == 4401


async def test_unknown_run_or_batch_is_4404(server, user_client):
    headers = {"Origin": ORIGIN, "Cookie": cookie_of(user_client)}
    assert await close_code(f"{server}/api/runs/{uuid.uuid4()}/live", headers) == 4404
    assert await close_code(f"{server}/api/runs/live?batchId={uuid.uuid4()}", headers) == 4404
    assert await close_code(f"{server}/api/runs/live?batchId=nope", headers) == 4404


async def test_snapshot_then_ordered_events_then_finished(server, app, user_client, factory):
    drive = ScriptedDrive(
        before=[
            RunEvent("agent_audio", 10.0, {"chunk": 1, "bytes": len(AGENT_PCM)}, AGENT_PCM),
            RunEvent("agent_transcript", 20.0, {"turn": 0, "text": "Hello, how can I help?"}),
        ],
        after=[
            RunEvent(
                "turn_ended",
                30.0,
                {
                    "turn": 0,
                    "first_audio_ms": 10.0,
                    "end_ms": 25.0,
                    "playback_end_ms": 400.0,
                    "latency_ms": None,
                    "end_reason": "silence",
                },
            ),
            RunEvent(
                "caller_decision",
                40.0,
                {"decision_id": 1, "say": "I need a room", "hang_up": False, "reason": "opening"},
            ),
            RunEvent("caller_audio", 50.0, {"chunk": 1, "bytes": len(CALLER_PCM)}, CALLER_PCM),
            RunEvent("warning", 60.0, {"message": "server error: slow"}),
            RunEvent("agent_transcript", 70.0, {"turn": 1, "text": "Sure."}),
        ],
    )
    batch = await launch_one(user_client, factory, app, drive)
    run_id = batch["runs"][0]["id"]
    await wait_for(status_is(user_client, run_id, "running"))
    await asyncio.sleep(0.1)  # the `before` events are published

    headers = {"Origin": ORIGIN, "Cookie": cookie_of(user_client)}
    async with connect(f"{server}/api/runs/{run_id}/live", additional_headers=headers) as ws:
        snapshot = json.loads(await asyncio.wait_for(ws.recv(), 5))
        drive.go.set()
        messages = decoded(await receive_all(ws))
        code = ws.close_code

    assert snapshot["type"] == "snapshot"
    assert snapshot["run"]["id"] == run_id
    assert snapshot["run"]["status"] == "running"
    assert snapshot["transcript"] == [
        {"role": "agent", "text": "Hello, how can I help?", "turn": 0, "tMs": 20.0}
    ]
    assert kinds(messages) == [
        "turnEnded",
        "callerDecision",
        "audio:1",
        "warning",
        "agentTranscript",
        "finished",
    ]
    turn, decision, audio, warning, transcript, finished = messages
    assert turn == {
        "type": "turnEnded",
        "tMs": 30.0,
        "turn": 0,
        "firstAudioMs": 10.0,
        "endMs": 25.0,
        "playbackEndMs": 400.0,
        "latencyMs": None,
        "endReason": "silence",
    }
    assert decision == {
        "type": "callerDecision",
        "tMs": 40.0,
        "decisionId": 1,
        "say": "I need a room",
        "hangUp": False,
        "reason": "opening",
    }
    assert audio == b"\x01" + CALLER_PCM
    assert warning == {"type": "warning", "tMs": 60.0, "message": "server error: slow"}
    assert transcript == {"type": "agentTranscript", "tMs": 70.0, "turn": 1, "text": "Sure."}
    assert finished == {"type": "finished", "status": "completed", "reason": "caller_hung_up"}
    assert code == 1000


async def test_agent_audio_is_tagged_and_streams_live(server, app, user_client, factory):
    drive = ScriptedDrive(
        before=[],
        after=[RunEvent("agent_audio", 10.0, {"chunk": 1, "bytes": 480}, AGENT_PCM)],
    )
    batch = await launch_one(user_client, factory, app, drive)
    run_id = batch["runs"][0]["id"]
    await wait_for(status_is(user_client, run_id, "running"))

    headers = {"Origin": ORIGIN, "Cookie": cookie_of(user_client)}
    async with connect(f"{server}/api/runs/{run_id}/live", additional_headers=headers) as ws:
        assert json.loads(await ws.recv())["type"] == "snapshot"
        drive.go.set()
        messages = await receive_all(ws)

    assert messages[0] == b"\x00" + AGENT_PCM
    assert json.loads(messages[-1])["type"] == "finished"


async def test_a_finished_run_sends_its_snapshot_and_closes(server, app, user_client, factory):
    drive = ScriptedDrive(before=[], after=[])
    drive.go.set()
    batch = await launch_one(user_client, factory, app, drive)
    run_id = batch["runs"][0]["id"]
    await wait_for(status_is(user_client, run_id, "completed"))

    headers = {"Origin": ORIGIN, "Cookie": cookie_of(user_client)}
    async with connect(f"{server}/api/runs/{run_id}/live", additional_headers=headers) as ws:
        messages = decoded(await receive_all(ws))
        code = ws.close_code

    snapshot, finished = messages
    assert snapshot["run"]["status"] == "completed"
    assert snapshot["transcript"] == [
        {"role": "agent", "text": "hello", "startMs": 0.0, "endMs": 400.0}
    ]
    assert finished == {"type": "finished", "status": "completed", "reason": "caller_hung_up"}
    assert code == 1000


async def test_batch_overview_streams_statuses_until_the_batch_ends(
    server, app, user_client, factory
):
    drive = ScriptedDrive(before=[], after=[])
    batch = await launch_one(user_client, factory, app, drive, repetitions=2)
    run_ids = [run["id"] for run in batch["runs"]]
    await wait_for(status_is(user_client, run_ids[0], "running"))

    headers = {"Origin": ORIGIN, "Cookie": cookie_of(user_client)}
    url = f"{server}/api/runs/live?batchId={batch['id']}"
    async with connect(url, additional_headers=headers) as ws:
        snapshot = json.loads(await asyncio.wait_for(ws.recv(), 5))
        drive.go.set()
        messages = decoded(await receive_all(ws))
        code = ws.close_code

    assert snapshot["type"] == "snapshot"
    assert snapshot["batch"]["id"] == batch["id"]
    assert [run["id"] for run in snapshot["runs"]] == run_ids
    assert all(isinstance(message, dict) for message in messages)  # never audio
    finished = [m for m in messages if m["type"] == "finished"]
    assert sorted(m["runId"] for m in finished) == sorted(run_ids)
    assert all(m["status"] == "completed" for m in finished)
    assert messages[-1] == {"type": "batchFinished", "batchId": batch["id"]}
    assert code == 1000


# --- hub and backpressure (no socket) ------------------------------------------------------


async def drain(subscriber: Subscriber) -> list[str | bytes]:
    items = []
    while (item := await asyncio.wait_for(subscriber.get(), 1)) is not None:
        items.append(item)
    return items


async def test_a_slow_subscriber_loses_audio_but_never_text():
    hub = LiveHub(audio_frames_per_subscriber=4)
    run_id, batch_id = uuid.uuid4(), uuid.uuid4()
    hub.open(run_id, batch_id)
    slow = hub.subscribe(run_id)
    for i in range(10):
        hub.event(run_id, RunEvent("agent_audio", float(i), {}, AGENT_PCM))
        hub.event(run_id, RunEvent("warning", float(i), {"message": f"w{i}"}))
    hub.finish(run_id, "completed", "caller_hung_up")

    items = await drain(slow)
    texts = [json.loads(item) for item in items if isinstance(item, str)]
    audio = [item for item in items if isinstance(item, bytes)]
    assert [t["type"] for t in texts].count("lagging") == 1
    assert [t["message"] for t in texts if t["type"] == "warning"] == [f"w{i}" for i in range(10)]
    assert texts[0]["type"] == "snapshot" and texts[-1]["type"] == "finished"
    assert len(audio) == 4


async def test_only_spoken_caller_lines_reach_the_transcript():
    hub = LiveHub()
    run_id = uuid.uuid4()
    hub.open(run_id, uuid.uuid4())
    sub = hub.subscribe(run_id)
    decide = {"hang_up": False, "reason": "why"}
    for event in [
        RunEvent("caller_decision", 1.0, {"decision_id": 1, "say": "Stale", **decide}),
        RunEvent("agent_barge_in", 2.0, {"caller_turn": 0}),
        RunEvent("caller_decision_discarded", 3.0, {"decision_id": 1, "say": "Stale", **decide}),
        RunEvent("caller_decision", 4.0, {"decision_id": 2, "say": "Fresh", **decide}),
        RunEvent("caller_speaking", 5.0, {"decision_id": 2, "say": "Fresh", "reason": "why"}),
    ]:
        hub.event(run_id, event)
    hub.finish(run_id, "completed", "caller_hung_up")
    texts = [json.loads(item) for item in await drain(sub) if isinstance(item, str)]

    assert texts[1:-1] == [
        {
            "type": "callerDecision",
            "tMs": 1.0,
            "decisionId": 1,
            "say": "Stale",
            "hangUp": False,
            "reason": "why",
        },
        {"type": "agentBargeIn", "tMs": 2.0, "callerTurn": 0},
        {"type": "callerDecisionDiscarded", "tMs": 3.0, "decisionId": 1},
        {
            "type": "callerDecision",
            "tMs": 4.0,
            "decisionId": 2,
            "say": "Fresh",
            "hangUp": False,
            "reason": "why",
        },
        {"type": "callerSpeaking", "tMs": 5.0, "decisionId": 2, "say": "Fresh", "reason": "why"},
    ]


async def test_a_snapshot_lists_only_spoken_caller_lines():
    hub = LiveHub()
    run_id = uuid.uuid4()
    hub.open(run_id, uuid.uuid4())
    decide = {"hang_up": False, "reason": "why"}
    hub.event(
        run_id, RunEvent("caller_decision", 1.0, {"decision_id": 1, "say": "Stale", **decide})
    )
    hub.event(
        run_id, RunEvent("caller_decision_discarded", 3.0, {"decision_id": 1, "say": "Stale"})
    )
    hub.event(
        run_id, RunEvent("caller_decision", 4.0, {"decision_id": 2, "say": "Fresh", **decide})
    )
    hub.event(
        run_id,
        RunEvent("caller_speaking", 5.0, {"decision_id": 2, "say": "Fresh", "reason": "why"}),
    )
    snapshot = json.loads(await hub.subscribe(run_id).get())

    assert snapshot["transcript"] == [
        {"role": "caller", "text": "Fresh", "reason": "why", "tMs": 5.0}
    ]


async def test_a_consumer_that_catches_up_is_told_again_when_it_lags_again():
    hub = LiveHub(audio_frames_per_subscriber=2)
    run_id = uuid.uuid4()
    hub.open(run_id, uuid.uuid4())
    sub = hub.subscribe(run_id)
    await sub.get()  # snapshot
    for _ in range(3):
        hub.event(run_id, RunEvent("caller_audio", 0.0, {}, CALLER_PCM))
    assert [await sub.get() for _ in range(3)][-1].startswith('{"type": "lagging"')
    for _ in range(3):
        hub.event(run_id, RunEvent("caller_audio", 0.0, {}, CALLER_PCM))
    third = [await sub.get() for _ in range(3)]
    assert json.loads(third[-1])["type"] == "lagging"


async def test_runs_are_isolated_and_finishing_closes_only_their_subscribers():
    hub = LiveHub()
    first, second = uuid.uuid4(), uuid.uuid4()
    batch_id = uuid.uuid4()
    hub.open(first, batch_id)
    hub.open(second, batch_id)
    a, b = hub.subscribe(first), hub.subscribe(second)
    hub.event(first, RunEvent("warning", 1.0, {"message": "only first"}))
    hub.finish(first, "failed", "tts_failed")

    first_items = [json.loads(item) for item in await drain(a)]
    assert [item["type"] for item in first_items] == ["snapshot", "warning", "finished"]
    await b.get()  # snapshot
    hub.event(second, RunEvent("warning", 2.0, {"message": "only second"}))
    assert json.loads(await b.get())["message"] == "only second"
    assert hub.subscribe(first) is None  # finished runs are no longer live


async def test_a_text_backlog_past_the_limit_disconnects_the_consumer():
    hub = LiveHub(text_messages_per_subscriber=3)
    run_id = uuid.uuid4()
    hub.open(run_id, uuid.uuid4())
    sub = hub.subscribe(run_id)  # the snapshot is the first queued text
    for i in range(5):
        hub.event(run_id, RunEvent("warning", float(i), {"message": f"w{i}"}))

    items = [json.loads(item) for item in await drain(sub)]
    assert sub.too_slow and sub.ended
    assert [item["type"] for item in items] == ["snapshot", "warning", "warning"]
    hub.event(run_id, RunEvent("warning", 9.0, {"message": "late"}))  # ignored once ended
    assert sub.ended


class FakeSocket:
    """Just enough of a Starlette WebSocket for `_pump`."""

    def __init__(self) -> None:
        self.sent: list[str | bytes] = []
        self.closed_with: int | None = None
        self._left = asyncio.Event()

    async def send_text(self, text: str) -> None:
        self.sent.append(text)

    async def send_bytes(self, data: bytes) -> None:
        self.sent.append(data)

    async def receive(self) -> dict:
        await self._left.wait()
        return {"type": "websocket.disconnect"}

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code


async def test_a_too_slow_consumer_is_closed_with_1013():
    from voice_eval.modules.runs.live_api import CLOSE_TOO_SLOW, _pump

    hub = LiveHub(text_messages_per_subscriber=2)
    run_id = uuid.uuid4()
    hub.open(run_id, uuid.uuid4())
    sub = hub.subscribe(run_id)
    for i in range(4):
        hub.event(run_id, RunEvent("warning", float(i), {"message": f"w{i}"}))
    socket = FakeSocket()

    await asyncio.wait_for(_pump(socket, sub), 2)

    assert socket.closed_with == CLOSE_TOO_SLOW == 1013
    assert [json.loads(m)["type"] for m in socket.sent] == ["snapshot", "warning"]


async def test_batch_overview_keeps_its_snapshot_when_the_batch_ends_during_the_read(
    server, app, user_client, factory, monkeypatch
):
    from voice_eval.modules.runs import live_api

    drive = ScriptedDrive(before=[], after=[])
    batch = await launch_one(user_client, factory, app, drive)
    run_id = batch["runs"][0]["id"]
    await wait_for(status_is(user_client, run_id, "running"))
    hub = app.state.runs.hub
    real_get_batch = live_api.service.get_batch

    async def get_batch_while_the_run_ends(db, batch_id, **kwargs):
        loaded = await real_get_batch(db, batch_id, **kwargs)
        hub.finish(uuid.UUID(run_id), "completed", "caller_hung_up")  # ends during the read
        return loaded

    monkeypatch.setattr(live_api.service, "get_batch", get_batch_while_the_run_ends)
    headers = {"Origin": ORIGIN, "Cookie": cookie_of(user_client)}
    url = f"{server}/api/runs/live?batchId={batch['id']}"
    try:
        async with connect(url, additional_headers=headers) as ws:
            messages = decoded(await receive_all(ws))
            code = ws.close_code
    finally:
        drive.go.set()
        await wait_for(status_is(user_client, run_id, "completed"))

    assert kinds(messages) == ["snapshot", "finished", "batchFinished"]
    assert messages[0]["batch"]["id"] == batch["id"]
    assert code == 1000


async def test_a_failing_live_publish_never_breaks_the_run(app, user_client, factory, drive):
    def broken_publish(*args, **kwargs):
        raise RuntimeError("hub exploded")

    app.state.runs.hub.event = broken_publish
    app.state.runs.hub.status = broken_publish
    scenario = await factory.scenario()
    response = await user_client.post("/api/runs", json={"scenarioIds": [scenario["id"]]})
    run_id = response.json()["runs"][0]["id"]

    await wait_for(status_is(user_client, run_id, "running"))
    drive.release.set()
    await wait_for(status_is(user_client, run_id, "completed"))


async def test_an_interruption_streams_and_marks_the_agent_line():
    hub = LiveHub()
    run_id = uuid.uuid4()
    hub.open(run_id, uuid.uuid4())
    sub = hub.subscribe(run_id)
    cut = {"agent_turn": 1, "audio_end_ms": 1200, "heard_text": "Your balance"}
    hub.event(run_id, RunEvent("caller_interrupted", 3.0, cut))
    agent = {
        "turn": 0,
        "text": "Your balance is 20 dollars",
        "interrupted": True,
        "heard_text": "Your balance",
        "audio_end_ms": 1200,
    }
    hub.event(run_id, RunEvent("agent_transcript", 4.0, agent))
    hub.event(run_id, RunEvent("agent_transcript", 5.0, {"turn": 1, "text": "Sure"}))
    snapshot = json.loads(await hub.subscribe(run_id).get())
    hub.finish(run_id, "completed", "caller_hung_up")
    texts = [json.loads(item) for item in await drain(sub) if isinstance(item, str)]

    marked = {"interrupted": True, "heardText": "Your balance", "audioEndMs": 1200}
    assert texts[1:-1] == [
        {
            "type": "callerInterrupted",
            "tMs": 3.0,
            "agentTurn": 1,
            "audioEndMs": 1200,
            "heardText": "Your balance",
        },
        {"type": "agentTranscript", "tMs": 4.0, "turn": 0, "text": agent["text"], **marked},
        {"type": "agentTranscript", "tMs": 5.0, "turn": 1, "text": "Sure"},
    ]
    assert snapshot["transcript"] == [
        {"role": "agent", "text": agent["text"], "turn": 0, "tMs": 4.0, **marked},
        {"role": "agent", "text": "Sure", "turn": 1, "tMs": 5.0},
    ]
