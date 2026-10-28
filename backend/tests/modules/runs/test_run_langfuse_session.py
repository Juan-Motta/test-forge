"""Which Langfuse session holds a run's traces, and the report's link to them."""

import uuid
from datetime import UTC, datetime

import pytest

from voice_eval.modules.runs.api import traces_link
from voice_eval.modules.runs.domain import Run, RunStatus, langfuse_session_id

HOST = "https://lf.example"


def run(summary):
    return Run(
        id=uuid.uuid4(),
        batch_id=uuid.uuid4(),
        position=0,
        scenario_id=None,
        agent_id=None,
        thread_id="thread-1",
        status=RunStatus.COMPLETED,
        end_reason=None,
        created_at=datetime.now(UTC),
        started_at=None,
        ended_at=None,
        summary=summary,
        artifacts_dir=None,
        error=None,
        snapshot={},
    )


@pytest.mark.parametrize(
    ("summary", "expected"),
    [
        ({"protocol": "relay", "session_id": "agent-1"}, "agent-1"),
        ({"protocol": "relay", "session_id": ""}, "thread-1"),
        ({"protocol": "relay", "session_id": 7}, "thread-1"),
        ({"protocol": "live", "session_id": "vivi-session"}, "thread-1"),
        (None, "thread-1"),
        ("not a summary", "thread-1"),
    ],
)
def test_only_a_relay_run_uses_the_session_its_agent_reported(summary, expected):
    assert langfuse_session_id(summary, "thread-1") == expected


def test_a_relay_run_links_to_its_langfuse_session():
    link = traces_link(HOST, "proj", run({"protocol": "relay", "session_id": "agent-1"}))
    assert link == f"{HOST}/project/proj/sessions/agent-1"


def test_a_relay_run_without_a_session_url_links_to_its_thread_session():
    # Without a session URL the relay session is the thread id: still a session, not metadata.
    link = traces_link(HOST, "proj", run({"protocol": "relay", "session_id": "thread-1"}))
    assert link == f"{HOST}/project/proj/sessions/thread-1"


def test_a_vivi_run_links_to_its_traces_by_thread_id_metadata():
    link = traces_link(HOST, "proj", run({"protocol": "live", "session_id": "vivi-session"}))
    assert link is not None and "/traces?filter=metadata" in link and "thread-1" in link


def test_no_link_without_a_project():
    assert traces_link(HOST, None, run({"protocol": "relay", "session_id": "agent-1"})) is None
