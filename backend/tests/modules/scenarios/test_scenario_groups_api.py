# ruff: noqa: F811 - the tests take the imported `agent_id` fixture as an argument
import uuid

# Helpers and the `agent_id` fixture of the scenarios API tests (same directory, on sys.path).
from test_scenarios_api import agent_id, create, make_agent, scenario  # noqa: F401

GROUP_FIELDS = {
    "id",
    "name",
    "description",
    "tags",
    "scenarioCount",
    "agents",
    "latestScenarioAt",
    "createdAt",
    "updatedAt",
}


async def make_group(client, name: str = "Smoke tests", **fields) -> dict:
    response = await client.post("/api/scenario-groups", json={"name": name, **fields})
    assert response.status_code == 201, response.text
    return response.json()


async def test_requires_authentication(client):
    some = uuid.uuid4()
    assert (await client.get("/api/scenario-groups")).status_code == 401
    assert (await client.post("/api/scenario-groups", json={})).status_code == 401
    assert (await client.get(f"/api/scenario-groups/{some}")).status_code == 401
    assert (await client.patch(f"/api/scenario-groups/{some}", json={})).status_code == 401
    assert (await client.delete(f"/api/scenario-groups/{some}")).status_code == 401


async def test_creates_a_group_with_title_description_and_tags(user_client):
    body = await make_group(
        user_client,
        "  Smoke tests ",
        description=" Quick checks before a release. ",
        tags=["smoke", " fast ", "smoke"],
    )
    assert set(body) == GROUP_FIELDS
    assert body["name"] == "Smoke tests"
    assert body["description"] == "Quick checks before a release."
    assert body["tags"] == ["smoke", "fast"]
    assert body["scenarioCount"] == 0
    assert body["agents"] == []
    assert body["latestScenarioAt"] is None
    fetched = await user_client.get(f"/api/scenario-groups/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == body


async def test_group_names_are_unique_and_required(user_client):
    await make_group(user_client, "Smoke tests")
    taken = await user_client.post("/api/scenario-groups", json={"name": "Smoke tests"})
    assert taken.status_code == 409
    assert taken.json()["detail"] == "Group name already in use"
    blank = await user_client.post("/api/scenario-groups", json={"name": "   "})
    assert blank.status_code == 422
    assert blank.json()["detail"][0]["loc"] == ["body", "name"]


async def test_lists_groups_alphabetically_with_their_scenarios_and_agents(user_client):
    hotel = await make_agent(user_client, "Hotel desk")
    support = await make_agent(user_client, "Support triage")
    mixed = await make_group(user_client, "Regression")
    await make_group(user_client, "Empty one")
    await create(user_client, hotel, name="Booking", groupId=mixed["id"])
    await create(user_client, support, name="Refund", groupId=mixed["id"])

    listed = (await user_client.get("/api/scenario-groups")).json()
    assert [group["name"] for group in listed] == ["Empty one", "Regression"]
    regression = listed[1]
    # A group mixes agents: both are listed, by name.
    assert regression["scenarioCount"] == 2
    assert [agent["name"] for agent in regression["agents"]] == ["Hotel desk", "Support triage"]
    assert regression["latestScenarioAt"] is not None
    assert listed[0]["scenarioCount"] == 0


async def test_scenarios_without_a_group_join_the_group_named_after_their_agent(
    user_client, agent_id
):
    first = await create(user_client, agent_id, name="One")
    second = await create(user_client, agent_id, name="Two")
    assert first["group"]["name"] == "Vivi dev"
    assert second["groupId"] == first["groupId"]
    groups = (await user_client.get("/api/scenario-groups")).json()
    assert [(group["name"], group["scenarioCount"]) for group in groups] == [("Vivi dev", 2)]


async def test_creates_moves_and_filters_scenarios_by_group(user_client, agent_id):
    smoke = await make_group(user_client, "Smoke")
    nightly = await make_group(user_client, "Nightly")
    created = await create(user_client, agent_id, groupId=smoke["id"])
    assert created["group"] == {"id": smoke["id"], "name": "Smoke"}

    moved = await user_client.patch(
        f"/api/scenarios/{created['id']}", json={"groupId": nightly["id"]}
    )
    assert moved.status_code == 200
    assert moved.json()["group"] == {"id": nightly["id"], "name": "Nightly"}

    in_nightly = (await user_client.get("/api/scenarios", params={"groupId": nightly["id"]})).json()
    assert [scenario["id"] for scenario in in_nightly] == [created["id"]]
    assert (await user_client.get("/api/scenarios", params={"groupId": smoke["id"]})).json() == []

    duplicated = (await user_client.post(f"/api/scenarios/{created['id']}/duplicate")).json()
    assert duplicated["groupId"] == nightly["id"]


async def test_refuses_an_unknown_or_null_group(user_client, agent_id):
    unknown = await user_client.post(
        "/api/scenarios",
        json={**scenario(agent_id), "groupId": str(uuid.uuid4())},
    )
    assert unknown.status_code == 422
    assert unknown.json()["detail"] == [
        {"type": "value_error", "loc": ["body", "groupId"], "msg": "group not found"}
    ]
    created = await create(user_client, agent_id)
    cleared = await user_client.patch(f"/api/scenarios/{created['id']}", json={"groupId": None})
    assert cleared.status_code == 422
    assert cleared.json()["detail"][0]["loc"] == ["body", "groupId"]


async def test_updates_a_group_partially(user_client):
    group = await make_group(user_client, "Smoke", description="Old", tags=["a"])
    updated = await user_client.patch(
        f"/api/scenario-groups/{group['id']}", json={"description": "New", "tags": ["b"]}
    )
    assert updated.status_code == 200
    assert (updated.json()["name"], updated.json()["description"], updated.json()["tags"]) == (
        "Smoke",
        "New",
        ["b"],
    )
    renamed = await user_client.patch(
        f"/api/scenario-groups/{group['id']}", json={"name": "Smoke tests"}
    )
    assert renamed.json()["name"] == "Smoke tests"
    nulled = await user_client.patch(f"/api/scenario-groups/{group['id']}", json={"name": None})
    assert nulled.status_code == 422
    other = await make_group(user_client, "Other")
    clash = await user_client.patch(
        f"/api/scenario-groups/{other['id']}", json={"name": "Smoke tests"}
    )
    assert clash.status_code == 409
    missing = await user_client.patch(f"/api/scenario-groups/{uuid.uuid4()}", json={"name": "X"})
    assert missing.status_code == 404


async def test_deletes_only_an_empty_group(user_client, agent_id):
    group = await make_group(user_client, "Smoke")
    created = await create(user_client, agent_id, groupId=group["id"])
    refused = await user_client.delete(f"/api/scenario-groups/{group['id']}")
    assert refused.status_code == 409
    assert refused.json()["detail"] == "Group holds 1 scenario(s); move or delete them first"
    assert (await user_client.get(f"/api/scenarios/{created['id']}")).status_code == 200

    assert (await user_client.delete(f"/api/scenarios/{created['id']}")).status_code == 204
    assert (await user_client.delete(f"/api/scenario-groups/{group['id']}")).status_code == 204
    assert (await user_client.get(f"/api/scenario-groups/{group['id']}")).status_code == 404
    assert (await user_client.delete(f"/api/scenario-groups/{group['id']}")).status_code == 404
