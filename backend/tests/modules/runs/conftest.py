"""Fixtures for the runs module tests (helpers live in `runs_support`)."""

import pytest
from runs_support import BlockingDrive, Factory


@pytest.fixture
def factory(user_client) -> Factory:
    return Factory(user_client)


@pytest.fixture
def drive(app) -> BlockingDrive:
    fake = BlockingDrive()
    app.state.runs.drive = fake
    return fake
