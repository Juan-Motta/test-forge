"""Agents domain: target URL and Origin rules, and the probe target built from an agent."""

import uuid
from datetime import UTC, datetime

import pytest

from voice_eval.modules.agents.domain import (
    Agent,
    AgentProtocol,
    InvalidAgentInput,
    check_base_url,
    check_origin,
    target_spec,
)
from voice_eval.targets.connection import realtime_url
from voice_eval.targets.detect import TargetSpec

NOW = datetime(2026, 10, 10, tzinfo=UTC)


def agent(**overrides) -> Agent:
    fields = {
        "id": uuid.uuid4(),
        "name": "Vivi dev",
        "context": "Answers balance questions.",
        "protocol": AgentProtocol.LIVE,
        "base_url": "wss://agents.example.com",
        "channel_id": "channel-123",
        "user_id": "probe user+1",
        "origin": "https://portal.example.com",
        "langfuse_connection_id": None,
        "created_at": NOW,
        "updated_at": NOW,
    }
    return Agent(**{**fields, **overrides})


def test_target_spec_maps_the_agent_with_a_fresh_thread_id():
    first = target_spec(agent())
    second = target_spec(agent())
    assert isinstance(first, TargetSpec)
    assert (first.base_url, first.channel_id, first.user_id, first.origin, first.protocol) == (
        "wss://agents.example.com",
        "channel-123",
        "probe user+1",
        "https://portal.example.com",
        "live",
    )
    assert uuid.UUID(first.thread_id).version == 4
    assert first.thread_id != second.thread_id


def test_target_spec_accepts_an_explicit_thread_id_and_encodes_the_user_id():
    spec = target_spec(agent(origin=None, protocol=AgentProtocol.AUTO), thread_id="t-1")
    assert (spec.thread_id, spec.origin, spec.protocol) == ("t-1", None, "auto")
    url = realtime_url(spec.base_url, spec.channel_id, spec.user_id, spec.thread_id)
    assert "userId=probe+user%2B1" in url
    assert url.startswith("wss://agents.example.com/channelApi/channel-123/realtime?")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("wss://agents.example.com", "wss://agents.example.com"),
        ("  wss://agents.example.com/base/  ", "wss://agents.example.com/base"),
        ("wss://agents.example.com:8443", "wss://agents.example.com:8443"),
    ],
)
def test_base_url_accepts_wss(value, expected):
    assert check_base_url(value, allow_local_ws=False) == expected


@pytest.mark.parametrize(
    "value",
    [
        "ws://agents.example.com",  # plain ws to a remote host
        "https://agents.example.com",
        "ws://localhost:8000",  # local ws outside development
        "wss://user:pass@agents.example.com",
        "wss://agents.example.com?x=1",
        "wss://agents.example.com#frag",
        "wss://agents.example.com/a b",
        "wss://",
        "wss://agents.example.com:99999",
        "",
        "wss://" + "a" * 2050,
    ],
)
def test_base_url_rejects(value):
    with pytest.raises(InvalidAgentInput) as info:
        check_base_url(value, allow_local_ws=False)
    assert [e["loc"] for e in info.value.errors] == [["baseUrl"]]
    assert value not in str(info.value.errors) or not value


@pytest.mark.parametrize("value", ["ws://localhost:8000", "ws://127.0.0.1:9000/x"])
def test_local_ws_is_accepted_only_in_development(value):
    assert check_base_url(value, allow_local_ws=True) == value
    with pytest.raises(InvalidAgentInput):
        check_base_url(value, allow_local_ws=False)


def test_local_ws_never_extends_to_remote_hosts():
    with pytest.raises(InvalidAgentInput):
        check_base_url("ws://10.0.0.1", allow_local_ws=True)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://portal.example.com", "https://portal.example.com"),
        ("https://portal.example.com/", "https://portal.example.com"),
        ("http://localhost:3000", "http://localhost:3000"),
    ],
)
def test_origin_accepts_scheme_host_and_port(value, expected):
    assert check_origin(value) == expected


@pytest.mark.parametrize(
    "value",
    [
        "portal.example.com",
        "wss://portal.example.com",
        "https://portal.example.com/path",
        "https://user@portal.example.com",
        "https://portal.example.com?x=1",
        "https://portal.example.com#x",
        "https://",
        "https://portal .example.com",
    ],
)
def test_origin_rejects(value):
    with pytest.raises(ValueError):
        check_origin(value)
