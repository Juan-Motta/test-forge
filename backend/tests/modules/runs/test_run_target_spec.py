"""The target of one run, built from the agent snapshot the run stored."""

from voice_eval.modules.runs.manager import run_target_spec

VIVI = {
    "base_url": "wss://agents.example.com",
    "channel_id": "channel-123",
    "user_id": "probe-user",
    "origin": None,
    "protocol": "live",
}
RELAY = {
    "base_url": "ws://localhost:8000/api/voice",
    "channel_id": "",
    "user_id": None,
    "origin": "https://raaw.dev",
    "protocol": "relay",
    "session_url": "http://localhost:8000/api/sessions",
}


def test_a_relay_run_dials_its_session_url_like_its_socket():
    spec = run_target_spec(RELAY, "t-1", local_target_host="host.docker.internal")
    assert spec.base_url == "ws://host.docker.internal:8000/api/voice"
    assert spec.session_url == "http://host.docker.internal:8000/api/sessions"
    assert (spec.protocol, spec.user_id, spec.thread_id) == ("relay", "", "t-1")


def test_a_snapshot_from_before_session_urls_has_none():
    spec = run_target_spec(VIVI, "t-1", local_target_host=None)
    assert spec.session_url is None
    assert (spec.channel_id, spec.user_id) == ("channel-123", "probe-user")
