"""Fixtures for the judgement tests (helpers live in `judgements_support`)."""

from dataclasses import dataclass, field
from datetime import timedelta

import pytest
from judgements_support import ENDED, FakeClock, FakeJudgeModel, ScriptedReader


@dataclass
class Harness:
    """The fakes installed on `app.state.judgements`; tests swap `reader` and `model` freely."""

    clock: FakeClock
    reader: ScriptedReader = field(default_factory=ScriptedReader)
    model: FakeJudgeModel = field(default_factory=FakeJudgeModel)
    built: list[tuple[str, str]] = field(default_factory=list)


@pytest.fixture
def harness(app) -> Harness:
    fakes = Harness(clock=FakeClock(ENDED + timedelta(seconds=5)))
    coordinator = app.state.judgements

    async def build_judge(db, connection_id):
        fakes.built.append(("judge", str(connection_id)))
        return fakes.model

    async def build_trace_reader(db, connection_id):
        fakes.built.append(("traces", str(connection_id)))
        return fakes.reader

    coordinator.sleep = fakes.clock.sleep
    coordinator.now = fakes.clock.now
    coordinator.build_judge = build_judge
    coordinator.build_trace_reader = build_trace_reader
    return fakes
