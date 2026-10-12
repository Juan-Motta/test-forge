"""Agent connection test: open the agent's WebSocket like a run does, wait until its session is
ready, then close it the way a run closes it. No audio and no response request are ever sent.

The target is built like a run's (`run_target_spec`): the protocol is detected from the first
frames (a forced protocol must match), the Origin header is the agent's, and a loopback host is
dialled through `local_target_host`. Every step is logged with a safe message: the URL without
its query string, and never anything the agent sent back.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import dataclass, field
from urllib.parse import urlsplit, urlunsplit

from websockets.exceptions import ConnectionClosed, InvalidHandshake, InvalidStatus, InvalidURI

from voice_eval.modules.agents.domain import Agent
from voice_eval.ports.target import Ready, ServerEvent, TargetSession
from voice_eval.runner.common import close_session
from voice_eval.targets.connection import dial_base_url, open_socket, realtime_url
from voice_eval.targets.detect import (
    ProtocolDetectionError,
    TargetSpec,
    attach_session,
    detect_protocol,
)

log = logging.getLogger(__name__)

READY_TIMEOUT_S = 8.0  # connect, protocol detection and readiness, together
CLOSE_TIMEOUT_S = 3.0
TEST_THREAD_ID = "connection-test"


@dataclass(frozen=True)
class LogLine:
    ok: bool
    message: str


@dataclass
class ConnectionCheck:
    reachable: bool = False
    latency_ms: int | None = None
    protocol: str | None = None
    log: list[LogLine] = field(default_factory=list)

    def step(self, message: str, *, ok: bool = True) -> None:
        self.log.append(LogLine(ok, message))


def _safe_url(url: str) -> str:
    return urlunsplit(urlsplit(url)._replace(query="", fragment=""))


def _seconds(value: float) -> str:
    return f"{value:g}"


def _failure(exc: BaseException) -> str:
    if isinstance(exc, InvalidStatus):
        return f"The agent rejected the connection (HTTP {exc.response.status_code})"
    if isinstance(exc, InvalidURI):
        return "The agent's URL is not a valid WebSocket URL"
    if isinstance(exc, InvalidHandshake):
        return "The WebSocket handshake with the agent failed"
    if isinstance(exc, OSError):
        return "Could not connect: the connection was refused or the host is unreachable"
    return f"Connection failed ({type(exc).__name__})"


async def _until_ready(events: AsyncIterator[ServerEvent]) -> Ready | None:
    async for event in events:
        if isinstance(event, Ready):
            return event
    return None  # the socket closed first


async def _drain(events: AsyncIterator[ServerEvent]) -> None:
    async for _ in events:
        pass


async def check_connection(agent: Agent, *, local_target_host: str | None) -> ConnectionCheck:
    """Open, wait for readiness (at most `READY_TIMEOUT_S` in all), close. Never raises."""
    check = ConnectionCheck()
    spec = TargetSpec(
        base_url=dial_base_url(agent.base_url, local_target_host),
        channel_id=agent.channel_id,
        user_id=agent.user_id,
        thread_id=TEST_THREAD_ID,
        origin=agent.origin,
        protocol=agent.protocol.value,
    )
    url = realtime_url(spec.base_url, spec.channel_id, spec.user_id, spec.thread_id)
    check.step(f"Dialing {_safe_url(url)}")
    started = time.monotonic()
    stage = "connect"
    session: TargetSession | None = None
    try:
        async with asyncio.timeout(READY_TIMEOUT_S):
            ws = await open_socket(url, spec.origin)
            check.step(f"Connected in {round((time.monotonic() - started) * 1000)} ms")
            stage = "detect"
            try:
                protocol, pending = await detect_protocol(ws)
            except BaseException:
                await ws.close()
                raise
            check.protocol = protocol
            check.step(f"Protocol detected: {protocol}")
            if spec.protocol not in ("auto", protocol):
                await ws.close()
                check.step(
                    f"The agent speaks the {protocol} protocol, but this agent is set to "
                    f"{spec.protocol}",
                    ok=False,
                )
                return check
            session = attach_session(spec, ws, protocol, pending)
            stage = "ready"
            events = session.events()
            ready = await _until_ready(events)
    except TimeoutError:
        check.step(
            {
                "connect": f"No answer from the agent within {_seconds(READY_TIMEOUT_S)} s",
                "detect": "Connected, but the agent did not identify its protocol within "
                f"{_seconds(READY_TIMEOUT_S)} s",
                "ready": "Connected, but the session was not ready within "
                f"{_seconds(READY_TIMEOUT_S)} s",
            }[stage],
            ok=False,
        )
        await _disconnect(session)
        return check
    except ProtocolDetectionError:
        check.step("Connected, but the agent did not identify its protocol", ok=False)
        return check
    except ConnectionClosed:
        check.step("The agent closed the connection before the session was ready", ok=False)
        await _disconnect(session)
        return check
    except Exception as exc:
        log.info("agent connection test failed (%s)", type(exc).__name__)
        check.step(_failure(exc), ok=False)
        await _disconnect(session)
        return check
    if ready is None:
        check.step("The agent closed the connection before the session was ready", ok=False)
        await _disconnect(session)
        return check
    check.latency_ms = round((time.monotonic() - started) * 1000)
    check.reachable = True
    check.step(f"Session ready in {check.latency_ms} ms")
    reader = asyncio.create_task(_drain(events))
    warnings = await close_session(session, reader, timeout_s=CLOSE_TIMEOUT_S)
    for warning in warnings:
        check.step(f"Close: {warning}", ok=False)
    code = session.close_code
    check.step("Closed" if code is None else f"Closed (code {code})")
    return check


async def _disconnect(session: TargetSession | None) -> None:
    if session is not None:
        with suppress(Exception):
            await session.disconnect()
