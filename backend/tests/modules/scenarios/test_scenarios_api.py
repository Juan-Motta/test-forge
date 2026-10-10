"""Scenarios API: CRUD, validation, duplication, list filters, agent and connection references."""

import uuid

import pytest

AGENT = {
    "name": "Vivi dev",
    "baseUrl": "wss://agents.example.com",
    "channelId": "channel-123",
    "userId": "probe-user",
}
OPENAI = {"kind": "openai", "config": {}, "secrets": {"apiKey": "sk-proj-abcdefghijklmnop"}}
LANGFUSE = {
    "kind": "langfuse",
    "config": {"host": "https://cloud.langfuse.com", "publicKey": "pk-lf-123"},
    "secrets": {"secretKey": "sk-lf-abcdefghijkl"},
}
FIELDS = {
    "id",
    "agentId",
    "agent",
    "name",
    "tags",
    "context",
    "persona",
    "ttsConnectionId",
    "voiceOverride",
    "goal",
    "instructions",
    "facts",
    "criteria",
    "endConditions",
    "createdAt",
    "updatedAt",
}


def scenario(agent_id: str, **overrides) -> dict:
    return {
        "agentId": agent_id,
        "name": "Balance inquiry",
        "tags": ["billing", "smoke"],
        "context": "The caller is an existing customer.",
        "persona": {
            "name": "Lucía",
            "locale": "es-MX",
            "temperament": "hurried",
            "notes": "Calls from her car.",
        },
        "goal": "Learn the current account balance.",
        "instructions": "Do not volunteer the account number unless asked.",
        "facts": [{"key": "account_number", "value": "123-456"}],
        "criteria": [
            {
                "text": "Agent states the balance",
                "kind": "must",
                "source": "transcript",
                "weight": 70,
            },
            {"text": "Answers within 2 s", "kind": "should", "source": "timing", "weight": 30},
        ],
        **overrides,
    }


@pytest.fixture
async def agent_id(user_client) -> str:
    response = await user_client.post("/api/agents", json=AGENT)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def make_agent(client, name: str) -> str:
    response = await client.post("/api/agents", json={**AGENT, "name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def create(client, agent_id: str, **overrides) -> dict:
    response = await client.post("/api/scenarios", json=scenario(agent_id, **overrides))
    assert response.status_code == 201, response.text
    return response.json()


async def connection(client, name: str, body: dict) -> str:
    response = await client.post("/api/connections", json={"name": name, **body})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def locs(response) -> list[list[str]]:
    return [error["loc"] for error in response.json()["detail"]]


async def test_requires_authentication(client):
    some = uuid.uuid4()
    assert (await client.get("/api/scenarios")).status_code == 401
    assert (await client.post("/api/scenarios", json={})).status_code == 401
    assert (await client.get(f"/api/scenarios/{some}")).status_code == 401
    assert (await client.patch(f"/api/scenarios/{some}", json={})).status_code == 401
    assert (await client.delete(f"/api/scenarios/{some}")).status_code == 401
    assert (await client.post(f"/api/scenarios/{some}/duplicate")).status_code == 401


async def test_create_returns_the_scenario(user_client, agent_id):
    body = await create(user_client, agent_id)
    assert set(body) == FIELDS
    assert body["agentId"] == agent_id
    assert body["agent"] == {"id": agent_id, "name": "Vivi dev"}
    assert body["tags"] == ["billing", "smoke"]
    assert body["persona"] == {
        "name": "Lucía",
        "locale": "es-MX",
        "temperament": "hurried",
        "notes": "Calls from her car.",
    }
    assert body["facts"] == [{"key": "account_number", "value": "123-456"}]
    assert [c["weight"] for c in body["criteria"]] == [70, 30]
    assert all(uuid.UUID(c["id"]) for c in body["criteria"])  # server-generated
    assert body["criteria"][1] == {
        "id": body["criteria"][1]["id"],
        "text": "Answers within 2 s",
        "kind": "should",
        "source": "timing",
        "weight": 30,
    }
    assert body["endConditions"] == {
        "maxDurationS": 360,
        "maxSilenceS": 15,
        "hangUpWhen": "goal_or_goodbye",
    }
    assert (body["ttsConnectionId"], body["voiceOverride"]) == (None, None)


async def test_criterion_ids_are_kept_when_given(user_client, agent_id):
    given = str(uuid.uuid4())
    criteria = [{"id": given, "text": "x", "kind": "must", "source": "trace", "weight": 100}]
    body = await create(user_client, agent_id, criteria=criteria)
    assert body["criteria"][0]["id"] == given
    got = (await user_client.get(f"/api/scenarios/{body['id']}")).json()
    assert got["criteria"][0]["id"] == given


async def test_get_and_list_with_filters(user_client, agent_id):
    other_agent = await make_agent(user_client, "Other agent")
    first = await create(user_client, agent_id, name="first", tags=["smoke"])
    second = await create(user_client, agent_id, name="second", tags=["billing"])
    third = await create(user_client, other_agent, name="third", tags=["smoke"])

    got = await user_client.get(f"/api/scenarios/{first['id']}")
    assert got.status_code == 200
    assert got.json() == first

    listed = (await user_client.get("/api/scenarios")).json()
    assert [s["id"] for s in listed] == [third["id"], second["id"], first["id"]]  # newest first
    by_agent = (await user_client.get("/api/scenarios", params={"agentId": agent_id})).json()
    assert [s["id"] for s in by_agent] == [second["id"], first["id"]]
    by_tag = (await user_client.get("/api/scenarios", params={"tag": "smoke"})).json()
    assert [s["id"] for s in by_tag] == [third["id"], first["id"]]
    both = await user_client.get("/api/scenarios", params={"agentId": agent_id, "tag": "smoke"})
    assert [s["id"] for s in both.json()] == [first["id"]]

    await user_client.patch(f"/api/scenarios/{first['id']}", json={"goal": "Updated goal"})
    listed = (await user_client.get("/api/scenarios")).json()
    assert listed[0]["id"] == first["id"]  # most recently updated first


async def test_list_rejects_a_malformed_agent_filter(user_client):
    response = await user_client.get("/api/scenarios", params={"agentId": "nope"})
    assert response.status_code == 422
    assert locs(response) == [["query", "agentId"]]


async def test_unknown_id_is_404(user_client):
    missing = uuid.uuid4()
    assert (await user_client.get(f"/api/scenarios/{missing}")).status_code == 404
    patch = await user_client.patch(f"/api/scenarios/{missing}", json={"name": "x"})
    assert patch.status_code == 404
    assert (await user_client.delete(f"/api/scenarios/{missing}")).status_code == 404
    assert (await user_client.post(f"/api/scenarios/{missing}/duplicate")).status_code == 404


async def test_unknown_agent_is_422(user_client):
    response = await user_client.post("/api/scenarios", json=scenario(str(uuid.uuid4())))
    assert response.status_code == 422
    assert locs(response) == [["body", "agentId"]]


async def test_name_is_unique_per_agent(user_client, agent_id):
    await create(user_client, agent_id, name="Shared")
    dup = await user_client.post("/api/scenarios", json=scenario(agent_id, name=" Shared "))
    assert dup.status_code == 409
    assert dup.json() == {"detail": "Scenario name already in use for this agent"}

    other_agent = await make_agent(user_client, "Other agent")
    elsewhere = await create(user_client, other_agent, name="Shared")  # other agent: allowed
    moved = await user_client.patch(f"/api/scenarios/{elsewhere['id']}", json={"agentId": agent_id})
    assert moved.status_code == 409
    second = await create(user_client, agent_id, name="Second")
    renamed = await user_client.patch(f"/api/scenarios/{second['id']}", json={"name": "Shared"})
    assert renamed.status_code == 409


def _criteria(*weights: int) -> list[dict]:
    return [
        {"text": f"criterion {i}", "kind": "must", "source": "transcript", "weight": weight}
        for i, weight in enumerate(weights)
    ]


@pytest.mark.parametrize(
    ("overrides", "loc"),
    [
        ({"name": "  "}, ["body", "name"]),
        ({"name": "x" * 161}, ["body", "name"]),
        ({"tags": ["x" * 41]}, ["body", "tags", 0]),
        ({"tags": [" "]}, ["body", "tags", 0]),
        ({"tags": [f"t{i}" for i in range(21)]}, ["body", "tags"]),
        ({"context": "x" * 20001}, ["body", "context"]),
        (
            {"persona": {"name": "A", "locale": "Spanish", "temperament": "calm"}},
            ["body", "persona", "locale"],
        ),
        (
            {"persona": {"name": "A", "locale": "es-MX", "temperament": "sleepy"}},
            ["body", "persona", "temperament"],
        ),
        (
            {"persona": {"name": "", "locale": "es-MX", "temperament": "calm"}},
            ["body", "persona", "name"],
        ),
        (
            {"persona": {"name": "A", "locale": "es", "temperament": "calm", "notes": "x" * 2001}},
            ["body", "persona", "notes"],
        ),
        ({"voiceOverride": "bad voice!"}, ["body", "voiceOverride"]),
        ({"goal": " "}, ["body", "goal"]),
        ({"goal": "x" * 5001}, ["body", "goal"]),
        ({"instructions": "x" * 10001}, ["body", "instructions"]),
        ({"facts": [{"key": "k", "value": "1"}, {"key": "k", "value": "2"}]}, ["body", "facts"]),
        ({"facts": [{"key": "x" * 81, "value": "v"}]}, ["body", "facts", 0, "key"]),
        ({"facts": [{"key": "k", "value": "x" * 501}]}, ["body", "facts", 0, "value"]),
        ({"facts": [{"key": f"k{i}", "value": "v"} for i in range(51)]}, ["body", "facts"]),
        ({"criteria": _criteria(50, 40)}, ["body", "criteria"]),  # weights total 90
        ({"criteria": _criteria(60, 60)}, ["body", "criteria"]),  # weights total 120
        ({"criteria": []}, ["body", "criteria"]),
        ({"criteria": _criteria(*([1] * 31))}, ["body", "criteria"]),
        ({"criteria": _criteria(0, 100)}, ["body", "criteria", 0, "weight"]),
        ({"criteria": _criteria(101)}, ["body", "criteria", 0, "weight"]),
        (
            {"criteria": [{"text": "x", "kind": "may", "source": "transcript", "weight": 100}]},
            ["body", "criteria", 0, "kind"],
        ),
        (
            {"criteria": [{"text": "x", "kind": "must", "source": "vibes", "weight": 100}]},
            ["body", "criteria", 0, "source"],
        ),
        (
            {"criteria": [{"text": "x" * 501, "kind": "must", "source": "trace", "weight": 100}]},
            ["body", "criteria", 0, "text"],
        ),
        ({"endConditions": {"maxDurationS": 29}}, ["body", "endConditions", "maxDurationS"]),
        ({"endConditions": {"maxDurationS": 1801}}, ["body", "endConditions", "maxDurationS"]),
        ({"endConditions": {"maxSilenceS": 4}}, ["body", "endConditions", "maxSilenceS"]),
        ({"endConditions": {"maxSilenceS": 121}}, ["body", "endConditions", "maxSilenceS"]),
        ({"endConditions": {"hangUpWhen": "never"}}, ["body", "endConditions", "hangUpWhen"]),
        ({"ttsConnectionId": "nope"}, ["body", "ttsConnectionId"]),
        ({"agent": {"name": "x"}}, ["body", "agent"]),  # read-only summary
    ],
)
async def test_create_validation_errors(user_client, agent_id, overrides, loc):
    response = await user_client.post("/api/scenarios", json=scenario(agent_id, **overrides))
    assert response.status_code == 422, response.text
    assert loc in locs(response)


async def test_weight_total_error_is_explicit(user_client, agent_id):
    response = await user_client.post(
        "/api/scenarios", json=scenario(agent_id, criteria=_criteria(50, 40))
    )
    (error,) = response.json()["detail"]
    assert error["loc"] == ["body", "criteria"]
    assert "weights must total 100" in error["msg"]
    assert "90" in error["msg"]


async def test_duplicate_criterion_ids_are_rejected(user_client, agent_id):
    same = str(uuid.uuid4())
    criteria = _criteria(50, 50)
    criteria[0]["id"] = criteria[1]["id"] = same
    response = await user_client.post("/api/scenarios", json=scenario(agent_id, criteria=criteria))
    assert response.status_code == 422
    assert locs(response) == [["body", "criteria"]]


async def test_tags_are_trimmed_and_deduplicated(user_client, agent_id):
    body = await create(user_client, agent_id, tags=[" smoke ", "billing", "smoke"])
    assert body["tags"] == ["smoke", "billing"]


async def test_tts_connection_must_be_openai_or_azure_openai(user_client, agent_id):
    openai_id = await connection(user_client, "OpenAI", OPENAI)
    body = await create(user_client, agent_id, ttsConnectionId=openai_id, voiceOverride="coral")
    assert (body["ttsConnectionId"], body["voiceOverride"]) == (openai_id, "coral")

    langfuse_id = await connection(user_client, "Langfuse", LANGFUSE)
    wrong = await user_client.post(
        "/api/scenarios", json=scenario(agent_id, name="other", ttsConnectionId=langfuse_id)
    )
    assert wrong.status_code == 422
    assert locs(wrong) == [["body", "ttsConnectionId"]]
    missing = await user_client.post(
        "/api/scenarios",
        json=scenario(agent_id, name="other", ttsConnectionId=str(uuid.uuid4())),
    )
    assert missing.status_code == 422
    assert locs(missing) == [["body", "ttsConnectionId"]]


async def test_deleting_the_tts_connection_clears_the_reference(user_client, agent_id):
    openai_id = await connection(user_client, "OpenAI", OPENAI)
    body = await create(user_client, agent_id, ttsConnectionId=openai_id)
    assert (await user_client.delete(f"/api/connections/{openai_id}")).status_code == 204
    got = (await user_client.get(f"/api/scenarios/{body['id']}")).json()
    assert got["ttsConnectionId"] is None


async def test_patch_is_partial_and_replaces_whole_objects(user_client, agent_id):
    body = await create(user_client, agent_id, endConditions={"maxDurationS": 600})
    url = f"/api/scenarios/{body['id']}"
    response = await user_client.patch(
        url,
        json={
            "name": "Renamed",
            "facts": [],
            "criteria": _criteria(100),
            "persona": {"name": "Ana", "locale": "en-US", "temperament": "calm"},
            "endConditions": {"maxSilenceS": 20},
        },
    )
    assert response.status_code == 200, response.text
    patched = response.json()
    assert patched["name"] == "Renamed"
    assert patched["facts"] == []
    assert [c["text"] for c in patched["criteria"]] == ["criterion 0"]
    assert patched["persona"] == {
        "name": "Ana",
        "locale": "en-US",
        "temperament": "calm",
        "notes": "",
    }
    assert patched["endConditions"] == {
        "maxDurationS": 360,  # replaced as a whole: the omitted field takes its default
        "maxSilenceS": 20,
        "hangUpWhen": "goal_or_goodbye",
    }
    assert (patched["goal"], patched["tags"]) == (body["goal"], body["tags"])
    assert patched["createdAt"] == body["createdAt"]
    assert patched["updatedAt"] >= body["updatedAt"]


async def test_patch_moves_to_another_agent(user_client, agent_id):
    other_agent = await make_agent(user_client, "Other agent")
    body = await create(user_client, agent_id)
    response = await user_client.patch(
        f"/api/scenarios/{body['id']}", json={"agentId": other_agent}
    )
    assert response.status_code == 200
    assert response.json()["agent"] == {"id": other_agent, "name": "Other agent"}


async def test_patch_clears_optional_references(user_client, agent_id):
    openai_id = await connection(user_client, "OpenAI", OPENAI)
    body = await create(user_client, agent_id, ttsConnectionId=openai_id, voiceOverride="coral")
    response = await user_client.patch(
        f"/api/scenarios/{body['id']}", json={"ttsConnectionId": None, "voiceOverride": None}
    )
    assert response.status_code == 200
    assert (response.json()["ttsConnectionId"], response.json()["voiceOverride"]) == (None, None)


@pytest.mark.parametrize(
    ("patch", "loc"),
    [
        ({"name": None}, ["body", "name"]),
        ({"goal": None}, ["body", "goal"]),
        ({"criteria": None}, ["body", "criteria"]),
        ({"criteria": _criteria(10)}, ["body", "criteria"]),
        ({"agentId": None}, ["body", "agentId"]),
        ({"agentId": str(uuid.uuid4())}, ["body", "agentId"]),
        ({"id": str(uuid.uuid4())}, ["body", "id"]),
    ],
)
async def test_patch_validation_errors(user_client, agent_id, patch, loc):
    body = await create(user_client, agent_id)
    response = await user_client.patch(f"/api/scenarios/{body['id']}", json=patch)
    assert response.status_code == 422, response.text
    assert loc in locs(response)


async def test_patch_checks_the_tts_kind(user_client, agent_id):
    body = await create(user_client, agent_id)
    langfuse_id = await connection(user_client, "Langfuse", LANGFUSE)
    response = await user_client.patch(
        f"/api/scenarios/{body['id']}", json={"ttsConnectionId": langfuse_id}
    )
    assert response.status_code == 422
    assert locs(response) == [["body", "ttsConnectionId"]]


async def test_delete(user_client, agent_id):
    body = await create(user_client, agent_id)
    assert (await user_client.delete(f"/api/scenarios/{body['id']}")).status_code == 204
    assert (await user_client.get(f"/api/scenarios/{body['id']}")).status_code == 404


async def test_duplicate_names_copies_in_sequence(user_client, agent_id):
    body = await create(user_client, agent_id, name="Balance")
    url = f"/api/scenarios/{body['id']}/duplicate"
    first = await user_client.post(url)
    assert first.status_code == 201, first.text
    copy = first.json()
    assert copy["name"] == "Balance (copy)"
    assert copy["id"] != body["id"]
    same = {k: v for k, v in body.items() if k not in ("id", "name", "createdAt", "updatedAt")}
    assert {k: v for k, v in copy.items() if k in same} == same
    assert (await user_client.post(url)).json()["name"] == "Balance (copy 2)"
    assert (await user_client.post(url)).json()["name"] == "Balance (copy 3)"
    of_copy = await user_client.post(f"/api/scenarios/{copy['id']}/duplicate")
    assert of_copy.json()["name"] == "Balance (copy) (copy)"


async def test_duplicate_of_a_long_name_stays_within_the_limit(user_client, agent_id):
    body = await create(user_client, agent_id, name="x" * 160)
    copy = (await user_client.post(f"/api/scenarios/{body['id']}/duplicate")).json()
    assert len(copy["name"]) == 160
    assert copy["name"].endswith(" (copy)")


async def test_agent_in_use_cannot_be_deleted(user_client, agent_id):
    first = await create(user_client, agent_id, name="one")
    await create(user_client, agent_id, name="two")
    response = await user_client.delete(f"/api/agents/{agent_id}")
    assert response.status_code == 409
    assert response.json() == {"detail": "Agent is used by 2 scenario(s)"}
    assert (await user_client.get(f"/api/agents/{agent_id}")).status_code == 200

    await user_client.delete(f"/api/scenarios/{first['id']}")
    response = await user_client.delete(f"/api/agents/{agent_id}")
    assert response.json() == {"detail": "Agent is used by 1 scenario(s)"}


async def test_agent_without_scenarios_can_be_deleted(user_client, agent_id):
    body = await create(user_client, agent_id)
    await user_client.delete(f"/api/scenarios/{body['id']}")
    assert (await user_client.delete(f"/api/agents/{agent_id}")).status_code == 204


async def test_agent_rename_shows_in_the_summary(user_client, agent_id):
    body = await create(user_client, agent_id)
    await user_client.patch(f"/api/agents/{agent_id}", json={"name": "Vivi prod"})
    got = (await user_client.get(f"/api/scenarios/{body['id']}")).json()
    assert got["agent"] == {"id": agent_id, "name": "Vivi prod"}
