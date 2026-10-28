"""Agent connection test. Voice: open the agent's WebSocket like a run does, wait until its
session is ready, then close it the way a run closes it; no audio and no response request are
ever sent. Text: send one short message in a fresh conversation and wait for the whole reply
(this reaches the agent, which answers it).

The target is built like a run's (`run_target_spec`): the protocol is detected from the first
frames (a forced protocol must match), the Origin header is the agent's, and a loopback host is
dialled through `local_target_host`. Every step is logged with a safe message: the URL without
its query string, and never anything the agent sent back.
"""

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import dataclass, field
from urllib.parse import urlsplit, urlunsplit

import httpx
from websockets.exceptions import ConnectionClosed, InvalidHandshake, InvalidStatus, InvalidURI

from voice_eval.modules.agents.domain import Agent, AgentKind, AgentProtocol, TextMode
from voice_eval.ports.target import Ready, ServerError, ServerEvent, TargetSession
from voice_eval.ports.text_target import TextTargetError, collect
from voice_eval.runner.common import close_session
from voice_eval.targets.connection import dial_base_url, open_socket, realtime_url
from voice_eval.targets.detect import (
    ProtocolDetectionError,
    TargetSpec,
    attach_session,
    detect_protocol,
    open_relay,
)
from voice_eval.targets.http_chat import HttpChatTarget
from voice_eval.targets.relay import SessionCreateError, relay_url

log = logging.getLogger(__name__)

READY_TIMEOUT_S = 8.0  # connect, protocol detection and readiness, together
CLOSE_TIMEOUT_S = 3.0
TEST_THREAD_ID = "connection-test"
TEXT_TEST_MESSAGE = "Hello, this is a connection test."
TEXT_TEST_TIMEOUT_S = 60.0  # the whole reply, tools included


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
    if agent.protocol == AgentProtocol.RELAY:
        return await _check_relay(agent, local_target_host=local_target_host)
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
    await _close(check, session, events)
    return check


async def _check_relay(agent: Agent, *, local_target_host: str | None) -> ConnectionCheck:
    """A relay agent: create the session (when it has a session URL), dial, wait for `ready`."""
    check = ConnectionCheck(protocol=AgentProtocol.RELAY.value)
    session_url = agent.session_url and dial_base_url(agent.session_url, local_target_host)
    spec = TargetSpec(
        base_url=dial_base_url(agent.base_url, local_target_host),
        channel_id=agent.channel_id,
        user_id="",
        thread_id=TEST_THREAD_ID,
        origin=agent.origin,
        protocol="relay",
        session_url=session_url,
    )
    if session_url:
        check.step(f"Creating a session at {_safe_url(session_url)}")
    else:
        check.step(f"Dialing {_safe_url(relay_url(spec.base_url, TEST_THREAD_ID))}")
    started = time.monotonic()
    session: TargetSession | None = None
    try:
        async with asyncio.timeout(READY_TIMEOUT_S):
            session = await open_relay(spec)
            check.step(f"Connected in {round((time.monotonic() - started) * 1000)} ms")
            events = session.events()
            ready: Ready | None = None
            async for event in events:
                if isinstance(event, ServerError):
                    check.step(f"The agent answered with an error: {event.message}", ok=False)
                    await _disconnect(session)
                    return check
                if isinstance(event, Ready):
                    ready = event
                    break
    except TimeoutError:
        check.step(f"The session was not ready within {_seconds(READY_TIMEOUT_S)} s", ok=False)
        await _disconnect(session)
        return check
    except SessionCreateError as exc:
        check.step(f"Could not create the session: {exc}", ok=False)
        return check
    except Exception as exc:
        log.info("relay agent connection test failed (%s)", type(exc).__name__)
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
    await _close(check, session, events)
    return check


async def _close(
    check: ConnectionCheck, session: TargetSession, events: AsyncIterator[ServerEvent]
) -> None:
    """Close like a run does; a failure is logged as a step, never raised."""
    reader = asyncio.create_task(_drain(events))
    try:
        warnings = await close_session(session, reader, timeout_s=CLOSE_TIMEOUT_S)
    except Exception as exc:
        log.info("agent connection test close failed (%s)", type(exc).__name__)
        check.step(f"Close failed ({type(exc).__name__})", ok=False)
        await _disconnect(session)
        reader.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await reader
        return
    for warning in warnings:
        check.step(f"Close: {warning}", ok=False)
    try:
        code = session.close_code
    except Exception:
        code = None
    check.step("Closed" if code is None else f"Closed (code {code})")


async def _disconnect(session: TargetSession | None) -> None:
    if session is not None:
        with suppress(Exception):
            await session.disconnect()


def text_target(
    agent: Agent,
    api_key: str | None,
    *,
    local_target_host: str | None,
    allow_private: bool,
    transport: httpx.AsyncBaseTransport | None = None,
) -> HttpChatTarget:
    """The chat target of text `agent`, dialled like a voice agent (loopback via
    `local_target_host`) and through the egress guard unless `transport` is given."""
    if agent.kind != AgentKind.TEXT:
        raise ValueError("only text agents have a chat target")
    return HttpChatTarget(
        base_url=dial_base_url(agent.base_url, local_target_host),
        channel_id=agent.channel_id,
        mode=(agent.text_mode or TextMode.STREAM).value,
        api_key=api_key,
        origin=agent.origin,
        transport=transport,
        allow_private=allow_private,
    )


async def check_text_connection(
    agent: Agent,
    api_key: str | None,
    *,
    local_target_host: str | None,
    allow_private: bool,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ConnectionCheck:
    """Send `TEXT_TEST_MESSAGE` with a fresh threadId and wait for the reply. Never raises.

    The log never carries what the agent answered, nor the API key.
    """
    check = ConnectionCheck()
    target = text_target(
        agent,
        api_key,
        local_target_host=local_target_host,
        allow_private=allow_private,
        transport=transport,
    )
    check.step(f"Sending a test message to {_safe_url(target.url)}")
    try:
        async with asyncio.timeout(TEXT_TEST_TIMEOUT_S):
            reply = await collect(target.send(TEXT_TEST_MESSAGE, thread_id=str(uuid.uuid4())))
    except TimeoutError:
        check.step(f"No complete reply within {_seconds(TEXT_TEST_TIMEOUT_S)} s", ok=False)
        return check
    except TextTargetError as exc:
        check.step(str(exc), ok=False)
        return check
    except Exception as exc:
        log.info("text agent connection test failed (%s)", type(exc).__name__)
        check.step(f"Connection failed ({type(exc).__name__})", ok=False)
        return check
    if reply.first_text_ms is not None:
        check.step(f"First text in {reply.first_text_ms} ms")
    if reply.tools:
        check.step(f"The agent used {len(reply.tools)} tool(s)")
    check.latency_ms = reply.total_ms
    check.reachable = True
    check.step(f"Reply received in {reply.total_ms} ms ({len(reply.text)} characters)")
    return check
