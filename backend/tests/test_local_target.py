"""Local targets: `ws://` agents on this machine, dialled from inside the backend container."""

import pytest

from voice_eval.targets.connection import dial_base_url


@pytest.mark.parametrize(
    ("base_url", "expected"),
    [
        ("ws://localhost:8000", "ws://host.docker.internal:8000"),
        ("ws://127.0.0.1:8000/base", "ws://host.docker.internal:8000/base"),
        ("ws://LOCALHOST", "ws://host.docker.internal"),
        ("wss://localhost:8443/x", "wss://host.docker.internal:8443/x"),
    ],
)
def test_local_hosts_are_dialled_through_the_configured_host(base_url, expected):
    assert dial_base_url(base_url, "host.docker.internal") == expected


@pytest.mark.parametrize(
    "base_url",
    ["wss://agents.example.com", "ws://host.docker.internal:8000", "wss://localhost.example.com"],
)
def test_other_hosts_are_untouched(base_url):
    assert dial_base_url(base_url, "host.docker.internal") == base_url


def test_without_a_configured_host_nothing_changes():
    assert dial_base_url("ws://localhost:8000", None) == "ws://localhost:8000"
    assert dial_base_url("ws://localhost:8000", "") == "ws://localhost:8000"


def test_the_setting_is_read_from_the_environment(monkeypatch):
    from voice_eval.platform.settings import Settings

    monkeypatch.setenv("LOCAL_TARGET_HOST", "host.docker.internal")
    settings = Settings(_env_file=None, database_url="postgresql+asyncpg://u:p@h/db")
    assert settings.local_target_host == "host.docker.internal"
    monkeypatch.delenv("LOCAL_TARGET_HOST")
    assert (
        Settings(_env_file=None, database_url="postgresql+asyncpg://u:p@h/db").local_target_host
        is None
    )


def test_runs_dial_the_agent_through_the_local_target_host():
    from voice_eval.modules.runs.manager import run_target_spec

    agent = {
        "base_url": "ws://localhost:8000",
        "channel_id": "chan",
        "user_id": "user",
        "origin": "http://localhost:3001",
        "protocol": "realtime",
    }
    spec = run_target_spec(agent, "thread-1", local_target_host="host.docker.internal")
    assert spec.base_url == "ws://host.docker.internal:8000"
    assert spec.origin == "http://localhost:3001"  # sent as configured
    assert (spec.thread_id, spec.channel_id, spec.protocol) == ("thread-1", "chan", "realtime")
    assert run_target_spec(agent, "t", local_target_host=None).base_url == "ws://localhost:8000"
