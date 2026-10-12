"""Live WebSocket endpoints: `/api/runs/{id}/live` (one run) and `/api/runs/live?batchId=`.

Browsers cannot set headers on a WebSocket, so they authenticate with the session cookie (the
same resolution as HTTP requests) and, like any cookie-authenticated unsafe request, must come
from one of `WEB_ORIGINS`. Other clients send `Authorization: Bearer <API key or session token>`
instead; like a Bearer HTTP request, that skips the Origin check (a browser cannot attach the
header). The connection is accepted first so the refusal can carry a close code: 4403 foreign or
missing Origin (cookie only), 4401 not authenticated, 4404 unknown run or batch, 1013 the
consumer was too slow. Message format: see `modules.runs.live`.
"""

import asyncio
import contextlib
import uuid

from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect

from voice_eval.modules.runs import service
from voice_eval.modules.runs.api import RunOut, camelize
from voice_eval.modules.runs.domain import BatchNotFound, Run, RunNotFound
from voice_eval.modules.runs.live import Subscriber, message
from voice_eval.modules.runs.manager import RunManager, read_json
from voice_eval.modules.users.deps import (
    authenticate,
    authenticate_bearer,
    bearer_token,
    origin_allowed,
)
from voice_eval.platform.settings import Settings

CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN_ORIGIN = 4403
CLOSE_NOT_FOUND = 4404
CLOSE_TOO_SLOW = 1013  # "try again later"

router = APIRouter(prefix="/runs", tags=["runs"])


async def _admit(websocket: WebSocket) -> bool:
    """Accept, then close with the refusal code unless the caller is authenticated: by a Bearer
    header, or by the session cookie from an allowed Origin."""
    await websocket.accept()
    settings: Settings = websocket.app.state.settings
    if bearer := bearer_token(websocket.headers):
        async with websocket.app.state.sessionmaker() as db:
            principal = await authenticate_bearer(db, bearer)
        if principal is None:
            await websocket.close(CLOSE_UNAUTHENTICATED, "Not authenticated")
            return False
        return True
    origin = websocket.headers.get("origin")
    if origin is None or not origin_allowed(origin, settings):
        await websocket.close(CLOSE_FORBIDDEN_ORIGIN, "Origin not allowed")
        return False
    token = websocket.cookies.get(settings.session_cookie_name)
    resolved = None
    if token:
        async with websocket.app.state.sessionmaker() as db:
            resolved = await authenticate(db, token)
    if resolved is None:
        await websocket.close(CLOSE_UNAUTHENTICATED, "Not authenticated")
        return False
    return True


async def _pump(websocket: WebSocket, subscriber: Subscriber) -> None:
    """Send the subscriber's queue until it ends or the client leaves; then close."""

    async def send() -> None:
        while (item := await subscriber.get()) is not None:
            if isinstance(item, bytes):
                await websocket.send_bytes(item)
            else:
                await websocket.send_text(item)

    async def receive() -> None:  # the client sends nothing; this only notices it leaving
        with contextlib.suppress(WebSocketDisconnect):
            while (await websocket.receive())["type"] != "websocket.disconnect":
                pass

    sender = asyncio.create_task(send())
    receiver = asyncio.create_task(receive())
    try:
        done, _ = await asyncio.wait({sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in (sender, receiver):
            task.cancel()
        await asyncio.gather(sender, receiver, return_exceptions=True)
    if sender in done and sender.exception() is None:
        with contextlib.suppress(Exception):  # the client may have left meanwhile
            code = CLOSE_TOO_SLOW if subscriber.too_slow else 1000
            await websocket.close(code)


def _snapshot_of(run: Run, runs: RunManager) -> str:
    """A finished (or no longer live) run, as the first message of its stream."""
    transcript = read_json(runs.artifacts_dir(run.id) / "transcript.json")
    turns = (run.summary or {}).get("turns") or []
    return message(
        "snapshot",
        run={
            "id": str(run.id),
            "batchId": str(run.batch_id),
            "status": run.status.value,
            "endReason": run.end_reason,
        },
        transcript=camelize(transcript) if isinstance(transcript, list) else [],
        turns=camelize(turns),
    )


@router.websocket("/live")
async def batch_live(websocket: WebSocket) -> None:
    if not await _admit(websocket):
        return
    runs: RunManager = websocket.app.state.runs
    try:
        batch_id = uuid.UUID(websocket.query_params.get("batchId", ""))
    except ValueError:
        await websocket.close(CLOSE_NOT_FOUND, "Batch not found")
        return
    # Subscribe first, so no change is missed; the snapshot read below is then put ahead of
    # everything queued meanwhile, even when the batch ended during the read.
    subscriber = runs.hub.subscribe_batch(batch_id)
    try:
        async with websocket.app.state.sessionmaker() as db:
            try:
                batch = await service.get_batch(db, batch_id, with_runs=True)
            except BatchNotFound:
                await websocket.close(CLOSE_NOT_FOUND, "Batch not found")
                return
        snapshot = message(
            "snapshot",
            batch={"id": str(batch.id), "status": batch.status.value, "total": batch.total},
            runs=[
                RunOut.of(run).model_dump(mode="json", by_alias=True) for run in batch.runs or []
            ],
        )
        if subscriber is None:  # nothing live: the snapshot is the whole story
            await websocket.send_text(snapshot)
            await websocket.send_text(message("batchFinished", batchId=str(batch_id)))
            await websocket.close(1000)
            return
        subscriber.put_text(snapshot, first=True)
        await _pump(websocket, subscriber)
    finally:
        if subscriber is not None:
            runs.hub.unsubscribe_batch(batch_id, subscriber)


@router.websocket("/{run_id}/live")
async def run_live(websocket: WebSocket, run_id: str) -> None:
    if not await _admit(websocket):
        return
    runs: RunManager = websocket.app.state.runs
    try:
        run_uuid = uuid.UUID(run_id)
    except ValueError:
        await websocket.close(CLOSE_NOT_FOUND, "Run not found")
        return
    subscriber = runs.hub.subscribe(run_uuid)
    if subscriber is None:
        async with websocket.app.state.sessionmaker() as db:
            try:
                run = await service.get_run(db, run_uuid)
            except RunNotFound:
                await websocket.close(CLOSE_NOT_FOUND, "Run not found")
                return
        await websocket.send_text(_snapshot_of(run, runs))
        if run.finished:
            finished = message("finished", status=run.status.value, reason=run.end_reason)
            await websocket.send_text(finished)
        await websocket.close(1000)
        return
    try:
        await _pump(websocket, subscriber)
    finally:
        runs.hub.unsubscribe(run_uuid, subscriber)
