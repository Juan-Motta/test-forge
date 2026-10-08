"""In-process fake of the target Live endpoint, implementing the documented protocol."""

import asyncio
import base64
import json
from dataclasses import dataclass, field

import pytest
from websockets.asyncio.server import ServerConnection, serve

REPLY_DELTAS = 4
DELTA_BYTES = 4800


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

    async def _speak(self, ws: ServerConnection, role_id: str, text: str) -> None:
        words = text.split()
        for i in range(REPLY_DELTAS):
            delta = base64.b64encode(b"\x10\x00" * (DELTA_BYTES // 2)).decode()
            await ws.send(json.dumps({"type": "voice.audio.delta", "delta": delta}))
            caption = " ".join(words[: max(1, (i + 1) * len(words) // REPLY_DELTAS)])
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
        tasks = [asyncio.create_task(self._speak(ws, "a0", "hello I am the fake agent"))]
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
                speech, silence = speech + 1, 0
            elif speech:
                silence += 1
            if speech >= self.speech_frames_to_answer and silence >= self.silence_frames_to_answer:
                self.answers += 1
                speech = silence = 0
                tasks.append(asyncio.create_task(self._answer(ws, self.answers)))


@pytest.fixture
async def fake_live_server():
    fake = FakeLiveServer()
    async with serve(fake.handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        fake.url = f"ws://127.0.0.1:{port}"
        yield fake
