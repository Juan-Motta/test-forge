"""In-process fakes of the target endpoint: the Live protocol and the legacy realtime relay."""

import asyncio
import base64
import json
import time
from collections.abc import Coroutine
from contextlib import AsyncExitStack, suppress
from dataclasses import dataclass, field
from typing import Any

import pytest
from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

REPLY_DELTAS = 4
DELTA_BYTES = 4800


async def _quietly(coro: Coroutine[Any, Any, None]) -> None:
    """Run a fake's background send task; the client may close the socket at any point."""
    with suppress(ConnectionClosed):
        await coro


@dataclass
class FakeLiveServer:
    speech_frames_to_answer: int = 2
    silence_frames_to_answer: int = 3
    url: str = ""
    paths: list[str] = field(default_factory=list)
    origins: list[str | None] = field(default_factory=list)
    received_types: list[str] = field(default_factory=list)
    protocol_violations: list[str] = field(default_factory=list)
    answers: int = 0
    # > 0: every agent turn is this much audio sent in one burst (faster than real time)
    burst_audio_ms: int = 0
    # monotonic seconds: first audio delta of each agent turn / first speech frame of each
    # caller utterance, as seen by the server
    agent_audio_started: list[float] = field(default_factory=list)
    caller_speech_started: list[float] = field(default_factory=list)

    async def _speak(self, ws: ServerConnection, role_id: str, text: str) -> None:
        words = text.split()
        deltas = self.burst_audio_ms * 2 * 24 // DELTA_BYTES or REPLY_DELTAS
        self.agent_audio_started.append(time.monotonic())
        for i in range(deltas):
            delta = base64.b64encode(b"\x10\x00" * (DELTA_BYTES // 2)).decode()
            await ws.send(json.dumps({"type": "voice.audio.delta", "delta": delta}))
            if self.burst_audio_ms and i < deltas - 1:
                continue  # one caption at the end, no pacing
            caption = " ".join(words[: max(1, (i + 1) * len(words) // deltas)])
            await ws.send(
                json.dumps(
                    {
                        "type": "voice.transcript.update",
                        "role": "assistant",
                        "messageId": role_id,
                        "text": caption,
                        "startMs": 0,
                        "endMs": 0,
                    }
                )
            )
            await asyncio.sleep(0.02)

    async def _answer(self, ws: ServerConnection, n: int) -> None:
        await ws.send(
            json.dumps(
                {
                    "type": "voice.transcript.update",
                    "role": "user",
                    "messageId": f"u{n}",
                    "text": f"caller turn {n}",
                    "startMs": n * 1000,
                    "endMs": n * 1000 + 300,
                }
            )
        )
        await ws.send(json.dumps({"type": "voice.task.status", "status": "thinking"}))
        await self._speak(ws, f"a{n}", f"agent reply number {n}")

    async def handler(self, ws: ServerConnection) -> None:
        self.paths.append(ws.request.path)
        self.origins.append(ws.request.headers.get("Origin"))
        await ws.send(json.dumps({"type": "voice.protocol", "protocol": "gpt_live"}))
        await ws.send(json.dumps({"type": "voice.ready", "sessionId": "sess-fake"}))
        tasks = [asyncio.create_task(_quietly(self._speak(ws, "a0", "hello I am the fake agent")))]
        speech = silence = 0
        async for raw in ws:
            msg = json.loads(raw)
            kind = msg.get("type")
            self.received_types.append(kind)
            if kind == "voice.close":
                await ws.send(
                    json.dumps(
                        {"type": "voice.closed", "usageSeconds": 1.5, "finalUsageConfirmed": True}
                    )
                )
                await ws.close(1000)
                return
            if kind != "voice.input.audio":
                self.protocol_violations.append(f"type={kind}")
                await ws.close(1008, "invalid message type")
                return
            b64 = msg["audio"]
            pcm = base64.b64decode(b64)
            if len(b64) > 131072 or not pcm or len(pcm) % 2 or len(raw) > 150000:
                self.protocol_violations.append(f"bad audio frame ({len(pcm)} bytes)")
                await ws.close(1008, "invalid audio")
                return
            if any(pcm):
                if not speech:
                    self.caller_speech_started.append(time.monotonic())
                speech, silence = speech + 1, 0
            elif speech:
                silence += 1
            if speech >= self.speech_frames_to_answer and silence >= self.silence_frames_to_answer:
                self.answers += 1
                speech = silence = 0
                tasks.append(asyncio.create_task(_quietly(self._answer(ws, self.answers))))


@pytest.fixture
async def fake_live_server():
    fake = FakeLiveServer()
    async with serve(fake.handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        fake.url = f"ws://127.0.0.1:{port}"
        yield fake


REALTIME_CLIENT_TYPES = frozenset(
    {
        "session.update",
        "input_audio_buffer.append",
        "input_audio_buffer.commit",
        "input_audio_buffer.clear",
        "conversation.item.create",
        "conversation.item.delete",
        "conversation.item.truncate",
        "response.create",
        "response.cancel",
    }
)


@dataclass
class FakeRealtimeServer:
    """Legacy realtime relay: OpenAI Realtime GA events, allow-listed client events, no greeting.

    A text turn whose text contains "tool" is answered with two responses: a
    function-call response, `response.processing` ticks while the tool "runs", then speech.
    """

    speech_frames_to_answer: int = 2
    silence_frames_to_answer: int = 3
    tick_s: float = 0.15
    ticks: int = 2
    url: str = ""
    paths: list[str] = field(default_factory=list)
    received_types: list[str] = field(default_factory=list)
    protocol_violations: list[str] = field(default_factory=list)
    client_close_codes: list[int | None] = field(default_factory=list)
    responses: int = 0
    items: int = 0
    allowed_types: frozenset[str] = REALTIME_CLIENT_TYPES
    closed: asyncio.Event = field(default_factory=asyncio.Event)
    # > 0: every spoken response is this much audio sent in one burst, then response.done
    burst_audio_ms: int = 0
    # monotonic seconds: first audio delta of each spoken response / each caller text item
    agent_audio_started: list[float] = field(default_factory=list)
    caller_text_received: list[float] = field(default_factory=list)

    async def _send(self, ws: ServerConnection, event: dict) -> None:
        await ws.send(json.dumps({**event, "turn_id": f"turn-{self.responses}"}))

    def _item_id(self) -> str:
        self.items += 1
        return f"item_{self.items}"

    async def _response(self, ws: ServerConnection, kind: str) -> None:
        self.responses += 1
        rid = f"resp_{self.responses}"
        await self._send(ws, {"type": "response.created", "response": {"id": rid}})
        if kind == "tool":
            call = {"id": self._item_id(), "type": "function_call", "name": "lookup"}
            await self._send(ws, {"type": "response.output_item.added", "item": call})
            await self._send(
                ws,
                {
                    "type": "response.function_call_arguments.done",
                    "item_id": call["id"],
                    "arguments": "{}",
                },
            )
            await self._send(ws, {"type": "response.done", "response": {"id": rid}})
            for _ in range(self.ticks):
                await asyncio.sleep(self.tick_s)
                await self._send(ws, {"type": "response.processing"})
            await asyncio.sleep(self.tick_s)
            await self._send(ws, {"type": "response.processing.done"})
            await asyncio.sleep(self.tick_s)
            await self._response(ws, "speech")
            return
        item_id = self._item_id()
        text = f"agent response number {self.responses}"
        item = {"id": item_id, "type": "message", "role": "assistant", "content": []}
        await self._send(ws, {"type": "conversation.item.added", "item": item})
        self.agent_audio_started.append(time.monotonic())
        if self.burst_audio_ms:
            delta = base64.b64encode(b"\x10\x00" * (DELTA_BYTES // 2)).decode()
            for _ in range(self.burst_audio_ms * 2 * 24 // DELTA_BYTES):
                audio = {"type": "response.output_audio.delta", "item_id": item_id, "delta": delta}
                await self._send(ws, audio)
        for word in text.split():
            if self.burst_audio_ms:
                await self._send(
                    ws,
                    {
                        "type": "response.output_audio_transcript.delta",
                        "item_id": item_id,
                        "delta": word + " ",
                    },
                )
                continue
            delta = base64.b64encode(b"\x10\x00" * (DELTA_BYTES // 2)).decode()
            await self._send(
                ws,
                {
                    "type": "response.output_audio.delta",
                    "item_id": item_id,
                    "delta": delta,
                    "playbackInterruptionSupported": True,
                },
            )
            await self._send(
                ws,
                {
                    "type": "response.output_audio_transcript.delta",
                    "item_id": item_id,
                    "delta": word + " ",
                },
            )
            await asyncio.sleep(0.02)
        await self._send(ws, {"type": "response.output_audio.done", "item_id": item_id})
        await self._send(
            ws,
            {
                "type": "response.output_audio_transcript.done",
                "item_id": item_id,
                "transcript": text,
            },
        )
        await self._send(ws, {"type": "response.done", "response": {"id": rid}})

    async def _answer_audio(self, ws: ServerConnection, text: str) -> None:
        item_id = self._item_id()
        item = {"id": item_id, "type": "message", "role": "user", "content": []}
        await self._send(ws, {"type": "input_audio_buffer.committed", "item_id": item_id})
        await self._send(ws, {"type": "conversation.item.added", "item": item})
        response = asyncio.create_task(_quietly(self._response(ws, "")))
        await asyncio.sleep(0.05)  # transcription lands after the response started
        await self._send(
            ws,
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": item_id,
                "transcript": text,
            },
        )
        await response

    async def handler(self, ws: ServerConnection) -> None:
        self.paths.append(ws.request.path)
        session = {
            "id": "sess_rt",
            "model": "gpt-realtime-2.1",
            "turn_detection": {"type": "server_vad", "silence_duration_ms": 500},
        }
        await self._send(ws, {"type": "session.created", "session": session})
        await self._send(ws, {"type": "session.updated", "session": session})
        system = {
            "id": self._item_id(),
            "type": "message",
            "role": "system",
            "content": [{"type": "input_text", "text": "Today is 2026-10-09."}],
        }
        await self._send(ws, {"type": "conversation.item.added", "item": system})
        await self._send(ws, {"type": "conversation.item.done", "item": system})
        await ws.send(b"\x00\x01\x02")  # stray binary frame: must be ignored
        tasks: list[asyncio.Task[None]] = []
        last_text = ""
        speech = silence = audio_turns = 0
        try:
            async for raw in ws:
                msg = json.loads(raw)
                kind = msg.get("type")
                self.received_types.append(kind)
                if kind not in REALTIME_CLIENT_TYPES:
                    self.protocol_violations.append(f"type={kind}")
                    await ws.close(
                        1011,
                        f"Unsupported outgoing realtime event for openai: '{kind}'",
                    )
                    return
                if kind == "conversation.item.create":
                    self.caller_text_received.append(time.monotonic())
                    item = {**msg["item"], "id": self._item_id()}
                    last_text = item["content"][0]["text"]
                    await self._send(ws, {"type": "conversation.item.added", "item": item})
                elif kind == "response.create":
                    kind = "tool" if "tool" in last_text else ""
                    tasks.append(asyncio.create_task(_quietly(self._response(ws, kind))))
                    last_text = ""
                elif kind == "input_audio_buffer.append":
                    pcm = base64.b64decode(msg.get("audio") or "")
                    if not pcm:
                        self.protocol_violations.append("empty audio append")
                        await ws.close(1011, "empty audio")
                        return
                    if any(pcm):
                        speech, silence = speech + 1, 0
                    elif speech:
                        silence += 1
                    if (
                        speech >= self.speech_frames_to_answer
                        and silence >= self.silence_frames_to_answer
                    ):
                        speech = silence = 0
                        audio_turns += 1
                        text = f"caller audio turn {audio_turns}"
                        answer = self._answer_audio(ws, text)
                        tasks.append(asyncio.create_task(_quietly(answer)))
        except ConnectionClosed:
            pass
        finally:
            self.client_close_codes.append(ws.close_code)
            self.closed.set()
            for task in tasks:
                task.cancel()


@pytest.fixture
async def fake_realtime_server():
    fake = FakeRealtimeServer()
    async with serve(fake.handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        fake.url = f"ws://127.0.0.1:{port}"
        yield fake


@dataclass
class ScriptedServer:
    """Sends fixed frames, then closes (`close_code`) or idles, recording what the client sends."""

    frames: list[str] = field(default_factory=list)
    close_code: int | None = None
    url: str = ""
    paths: list[str] = field(default_factory=list)
    received: list[str | bytes] = field(default_factory=list)

    async def handler(self, ws: ServerConnection) -> None:
        self.paths.append(ws.request.path)
        with suppress(ConnectionClosed):
            for frame in self.frames:
                await ws.send(frame)
            if self.close_code is not None:
                await ws.close(self.close_code, "scripted close")
                return
            async for raw in ws:
                self.received.append(raw)


@pytest.fixture
async def scripted_server():
    """Factory: `await scripted_server(frames, close_code=None)` starts one `ScriptedServer`."""
    async with AsyncExitStack() as stack:

        async def start(frames: list[str], close_code: int | None = None) -> ScriptedServer:
            fake = ScriptedServer(list(frames), close_code)
            server = await stack.enter_async_context(serve(fake.handler, "127.0.0.1", 0))
            fake.url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
            return fake

        yield start


# --- Backend platform: real PostgreSQL via testcontainers -------------------------------------

POSTGRES_IMAGE = "postgres:17"
WEB_ORIGIN = "http://localhost:3000"


@pytest.fixture(scope="session")
def master_key() -> str:
    """A fresh Fernet key for the encrypted connection secrets of this test session."""
    from cryptography.fernet import Fernet

    return Fernet.generate_key().decode()


def _docker_unavailable_reason() -> str | None:
    try:
        import docker

        docker.from_env().ping()
    except Exception as exc:  # any failure means "no usable Docker daemon"
        return f"Docker is not available for PostgreSQL tests: {exc.__class__.__name__}: {exc}"
    return None


@pytest.fixture(scope="session")
def postgres_url():
    """A migrated PostgreSQL 17 database shared by the whole session (skipped without Docker)."""
    reason = _docker_unavailable_reason()
    if reason:
        pytest.skip(reason)
    from testcontainers.community.postgres import PostgresContainer

    from voice_eval.platform.migrations import upgrade

    with PostgresContainer(POSTGRES_IMAGE, driver="asyncpg") as container:
        url = container.get_connection_url()
        upgrade(url)
        yield url


@pytest.fixture
def settings(postgres_url, master_key):
    from voice_eval.platform.settings import Settings

    return Settings(
        _env_file=None,
        database_url=postgres_url,
        voice_eval_master_key=master_key,
        web_origins=[WEB_ORIGIN],
        session_ttl_hours=12,
        session_cookie_secure=True,
        environment="test",
    )


@pytest.fixture
async def app(settings):
    """A fresh app (own engine) over emptied tables."""
    from sqlalchemy import text

    from voice_eval.platform.app import create_app

    application = create_app(settings)
    async with application.state.engine.begin() as conn:
        await conn.execute(
            text(
                "TRUNCATE users, user_sessions, login_attempts, provider_connections, agents,"
                " scenarios RESTART IDENTITY CASCADE"
            )
        )
    yield application
    await application.state.engine.dispose()


@pytest.fixture
async def client(app):
    from httpx import ASGITransport, AsyncClient

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://testserver") as c:
        yield c


@pytest.fixture
def db(app):
    """Factory for a database session bound to the test app's engine."""
    return app.state.sessionmaker


@pytest.fixture
def make_user(db):
    """`await make_user(email=..., password=..., is_active=...)` creates a user directly."""
    from sqlalchemy import update

    from voice_eval.modules.users import service
    from voice_eval.modules.users.models import UserRecord

    async def create(
        email: str = "ada@example.com",
        password: str = "correct horse battery staple",
        display_name: str = "Ada Lovelace",
        is_active: bool = True,
    ):
        async with db() as session:
            user = await service.create_user(session, email, display_name, password)
            if not is_active:
                await session.execute(
                    update(UserRecord).where(UserRecord.id == user.id).values(is_active=False)
                )
                await session.commit()
        return user

    return create


@pytest.fixture
async def user_client(client, make_user):
    """`client` logged in with a session cookie (no Origin header, like a non-browser caller)."""
    await make_user()
    response = await client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": "correct horse battery staple"},
    )
    assert response.status_code == 200, response.text
    return client
