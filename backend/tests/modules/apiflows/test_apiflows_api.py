import copy
import uuid

import pytest
from sqlalchemy import text

AGENT = {
    "name": "Vivi dev",
    "baseUrl": "wss://agents.example.com",
    "channelId": "channel-123",
    "userId": "probe-user",
}
SECRET = "sk_live_0123456789abcdef"
API = {
    "name": "Vivi Shop API",
    "description": "Catalog, carts and orders.",
    "tags": ["shop", "shop", "staging"],
    "baseUrl": "https://api.shop.example/v1/",
    "headers": [{"name": "Accept", "value": "application/json"}],
    "secrets": {"api_key": SECRET, "pin": "1234"},
}
STEPS = [
    {
        "title": "Get a JWT",
        "method": "POST",
        "path": "/auth/token",
        "headers": [{"name": "x-api-key", "value": "{{secret.api_key}}"}],
        "body": {"scope": "catalog:read"},
        "saves": [{"name": "token", "path": "body.access_token"}],
        "checks": [{"type": "status", "equals": 200}],
    },
    {
        "method": "GET",
        "path": "/products/search",
        "query": [
            {"name": "q", "value": "{{input.query}}"},
            {"name": "max", "value": "{{ input.max_price }}"},
        ],
        "headers": [{"name": "Authorization", "value": "Bearer {{saved.token}}"}],
        "checks": [
            {"type": "path", "path": "body.items.length", "op": ">", "value": 0},
            {"type": "duration", "maxMs": 2000},
        ],
    },
]
INPUTS = [
    {"name": "query", "description": "What to search for", "generate": "A product, 2-4 words"},
    {"name": "max_price", "type": "number", "default": "120"},
]


async def make_api(client, **overrides) -> dict:
    response = await client.post("/api/apis", json={**API, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


def flow_body(api_id: str, **overrides) -> dict:
    return {
        "apiId": api_id,
        "name": "Product search",
        "description": "Gets a JWT, then searches the catalog.",
        "inputs": copy.deepcopy(INPUTS),
        "steps": copy.deepcopy(STEPS),
        **overrides,
    }


async def make_flow(client, api_id: str, **overrides) -> dict:
    response = await client.post("/api/flows", json=flow_body(api_id, **overrides))
    assert response.status_code == 201, response.text
    return response.json()


async def make_agent(client, name: str = "Vivi dev") -> str:
    response = await client.post("/api/agents", json={**AGENT, "name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def test_requires_authentication(client):
    some = uuid.uuid4()
    for method, path in [
        ("GET", "/api/apis"),
        ("POST", "/api/apis"),
        ("GET", f"/api/apis/{some}"),
        ("GET", f"/api/apis/{some}/secrets"),
        ("PATCH", f"/api/apis/{some}"),
        ("DELETE", f"/api/apis/{some}"),
        ("GET", "/api/flows"),
        ("POST", "/api/flows"),
        ("GET", f"/api/flows/{some}"),
        ("PATCH", f"/api/flows/{some}"),
        ("DELETE", f"/api/flows/{some}"),
    ]:
        assert (await client.request(method, path, json={})).status_code == 401, path


async def test_creates_an_api_and_shows_its_secrets_masked(user_client):
    api = await make_api(user_client)
    assert api["name"] == "Vivi Shop API"
    assert api["baseUrl"] == "https://api.shop.example/v1"
    assert api["tags"] == ["shop", "staging"]
    assert api["headers"] == [{"name": "Accept", "value": "application/json"}]
    # Long values keep their last 4 characters; short ones only the mask.
    assert api["secrets"] == [
        {"name": "api_key", "hint": "••••cdef"},
        {"name": "pin", "hint": "••••"},
    ]
    assert (api["flowCount"], api["agents"]) == (0, [])
    for response in [
        await user_client.get(f"/api/apis/{api['id']}"),
        await user_client.get("/api/apis"),
    ]:
        assert response.status_code == 200
        assert SECRET not in response.text


async def test_reveals_the_secrets_on_request_and_seals_them_at_rest(app, user_client):
    api = await make_api(user_client)
    revealed = await user_client.get(f"/api/apis/{api['id']}/secrets")
    assert revealed.status_code == 200
    assert revealed.json() == {"secrets": {"api_key": SECRET, "pin": "1234"}}
    async with app.state.engine.connect() as conn:
        stored = (await conn.execute(text("SELECT secrets_ciphertext FROM apis"))).scalar_one()
    assert SECRET not in stored
    missing = await user_client.get(f"/api/apis/{uuid.uuid4()}/secrets")
    assert missing.status_code == 404


async def test_updates_single_secrets_and_keeps_the_others(user_client):
    api = await make_api(user_client)
    updated = await user_client.patch(
        f"/api/apis/{api['id']}", json={"secrets": {"pin": None, "token": "t-987654321"}}
    )
    assert updated.status_code == 200, updated.text
    assert [s["name"] for s in updated.json()["secrets"]] == ["api_key", "token"]
    revealed = (await user_client.get(f"/api/apis/{api['id']}/secrets")).json()
    assert revealed == {"secrets": {"api_key": SECRET, "token": "t-987654321"}}
    renamed = await user_client.patch(f"/api/apis/{api['id']}", json={"name": "Shop"})
    assert renamed.json()["name"] == "Shop"
    assert (await user_client.get(f"/api/apis/{api['id']}/secrets")).json() == revealed


async def test_an_api_holds_at_most_ten_secrets(user_client):
    api = await make_api(user_client, secrets={f"a{n}": "x" for n in range(10)})
    grown = await user_client.patch(f"/api/apis/{api['id']}", json={"secrets": {"b": "y"}})
    assert grown.status_code == 422
    assert grown.json()["detail"] == [
        {
            "type": "value_error",
            "loc": ["body", "secrets"],
            "msg": "an API holds at most 10 secrets",
        }
    ]
    swapped = await user_client.patch(
        f"/api/apis/{api['id']}", json={"secrets": {"a0": None, "b": "y"}}
    )
    assert swapped.status_code == 200
    assert len(swapped.json()["secrets"]) == 10


@pytest.mark.parametrize(
    ("overrides", "loc"),
    [
        ({"name": "  "}, ["body", "name"]),
        ({"baseUrl": "http://api.shop.example"}, ["body", "baseUrl"]),
        ({"baseUrl": "https://api.shop.example/v1?x=1"}, ["body", "baseUrl"]),
        ({"secrets": {"bad name": "x"}}, ["body", "secrets", "bad name", "[key]"]),
        ({"secrets": {"key": ""}}, ["body", "secrets", "key"]),
        ({"headers": [{"name": "bad header", "value": "x"}]}, ["body", "headers", 0, "name"]),
    ],
)
async def test_rejects_invalid_apis(user_client, overrides, loc):
    response = await user_client.post("/api/apis", json={**API, **overrides})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == loc
    assert SECRET not in response.text


async def test_accepts_a_local_http_base_url_and_refuses_duplicate_names(user_client):
    await make_api(user_client, baseUrl="http://localhost:8000")
    taken = await user_client.post("/api/apis", json={**API, "name": "Vivi Shop API"})
    assert taken.status_code == 409
    assert taken.json()["detail"] == "API name already in use"
    nulled = await user_client.patch(f"/api/apis/{uuid.uuid4()}", json={"secrets": None})
    assert nulled.status_code == 422


async def test_creates_lists_and_reads_flows(user_client):
    api = await make_api(user_client)
    other = await make_api(user_client, name="Booking API")
    agent = await make_agent(user_client)
    flow = await make_flow(user_client, api["id"], agentIds=[agent, agent])
    assert flow["api"] == {"id": api["id"], "name": "Vivi Shop API"}
    assert flow["agents"] == [{"id": agent, "name": "Vivi dev"}]
    assert flow["inputs"][1] == {
        "name": "max_price",
        "type": "number",
        "description": "",
        "default": "120",
        "generate": None,
    }
    assert flow["steps"][1]["checks"][1] == {"type": "duration", "maxMs": 2000}
    await make_flow(user_client, other["id"], name="Check availability", steps=[STEPS[0]])
    # The same name is fine in another API.
    await make_flow(user_client, other["id"])

    by_api = (await user_client.get("/api/flows", params={"apiId": api["id"]})).json()
    assert [f["id"] for f in by_api] == [flow["id"]]
    by_agent = (await user_client.get("/api/flows", params={"agentId": agent})).json()
    assert [f["id"] for f in by_agent] == [flow["id"]]
    assert (await user_client.get(f"/api/flows/{flow['id']}")).json() == flow

    listed = {a["name"]: a for a in (await user_client.get("/api/apis")).json()}
    assert listed["Vivi Shop API"]["flowCount"] == 1
    assert listed["Vivi Shop API"]["agents"] == [{"id": agent, "name": "Vivi dev"}]
    assert listed["Booking API"]["flowCount"] == 2


@pytest.mark.parametrize(
    ("steps", "loc", "msg"),
    [
        (
            [{**STEPS[1], "saves": []}],
            ["body", "steps", 0, "headers", 0, "value"],
            "no step saves 'token'",
        ),
        (
            [STEPS[1], STEPS[0]],
            ["body", "steps", 0, "headers", 0, "value"],
            "'token' is saved by step 2, which runs after this one",
        ),
        (
            [{**STEPS[0], "path": "/auth/{{input.tenant}}"}],
            ["body", "steps", 0, "path"],
            "unknown input 'tenant'",
        ),
        (
            [{**STEPS[0], "body": {"auth": {"key": "{{secret.password}}"}}}],
            ["body", "steps", 0, "body", "auth", "key"],
            "the API has no secret named 'password'",
        ),
        (
            [{**STEPS[0], "path": "/x/{{env.home}}"}],
            ["body", "steps", 0, "path"],
            "unknown placeholder source 'env'; use input, var, secret or saved",
        ),
        (
            [STEPS[0], {**STEPS[0], "path": "/again"}],
            ["body", "steps", 1, "saves", 0, "name"],
            "'token' is already saved by step 1",
        ),
    ],
)
async def test_rejects_flows_with_broken_references(user_client, steps, loc, msg):
    api = await make_api(user_client)
    response = await user_client.post("/api/flows", json=flow_body(api["id"], steps=steps))
    assert response.status_code == 422, response.text
    assert {"type": "value_error", "loc": loc, "msg": msg} in response.json()["detail"]


@pytest.mark.parametrize(
    ("overrides", "loc"),
    [
        ({"steps": []}, ["body", "steps"]),
        ({"steps": [{**STEPS[0], "method": "TRACE"}]}, ["body", "steps", 0, "method"]),
        ({"steps": [{**STEPS[0], "path": "auth"}]}, ["body", "steps", 0, "path"]),
        (
            {"steps": [{**STEPS[0], "saves": [{"name": "t", "path": "body..x"}]}]},
            ["body", "steps", 0, "saves", 0, "path"],
        ),
        (
            {"steps": [{**STEPS[0], "checks": [{"type": "path", "path": "body.a", "op": ">"}]}]},
            ["body", "steps", 0, "checks", 0, "path"],
        ),
        ({"inputs": [{"name": "1bad"}]}, ["body", "inputs", 0, "name"]),
        ({"agentIds": [str(uuid.uuid4())]}, ["body", "agentIds", 0]),
        ({"apiId": str(uuid.uuid4())}, ["body", "apiId"]),
    ],
)
async def test_rejects_invalid_flows(user_client, overrides, loc):
    api = await make_api(user_client)
    response = await user_client.post("/api/flows", json=flow_body(api["id"], **overrides))
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"][: len(loc)] == loc


async def test_rejects_duplicate_inputs(user_client):
    api = await make_api(user_client)
    inputs = [*INPUTS, {"name": "query"}]
    response = await user_client.post("/api/flows", json=flow_body(api["id"], inputs=inputs))
    assert response.status_code == 422
    assert response.json()["detail"] == [
        {
            "type": "value_error",
            "loc": ["body", "inputs", 2, "name"],
            "msg": "input 'query' is defined twice",
        }
    ]


async def test_updates_a_flow_partially(user_client):
    api = await make_api(user_client)
    agent = await make_agent(user_client)
    flow = await make_flow(user_client, api["id"], agentIds=[agent])
    renamed = await user_client.patch(
        f"/api/flows/{flow['id']}", json={"name": "Search", "description": "New"}
    )
    assert renamed.status_code == 200, renamed.text
    body = renamed.json()
    assert (body["name"], body["description"], body["agents"]) == ("Search", "New", flow["agents"])
    assert body["steps"] == flow["steps"]

    # Dropping the inputs breaks the steps that use them.
    broken = await user_client.patch(f"/api/flows/{flow['id']}", json={"inputs": []})
    assert broken.status_code == 422
    unlinked = await user_client.patch(f"/api/flows/{flow['id']}", json={"agentIds": []})
    assert unlinked.json()["agents"] == []

    second = await make_flow(user_client, api["id"], name="Other")
    clash = await user_client.patch(f"/api/flows/{second['id']}", json={"name": "Search"})
    assert clash.status_code == 409
    nulled = await user_client.patch(f"/api/flows/{flow['id']}", json={"steps": None})
    assert nulled.status_code == 422
    missing = await user_client.patch(f"/api/flows/{uuid.uuid4()}", json={"name": "X"})
    assert missing.status_code == 404


async def test_deletes_only_an_api_without_flows(user_client):
    api = await make_api(user_client)
    flow = await make_flow(user_client, api["id"])
    refused = await user_client.delete(f"/api/apis/{api['id']}")
    assert refused.status_code == 409
    assert refused.json()["detail"] == "API holds 1 flow(s); move or delete them first"
    assert (await user_client.delete(f"/api/flows/{flow['id']}")).status_code == 204
    assert (await user_client.get(f"/api/flows/{flow['id']}")).status_code == 404
    assert (await user_client.delete(f"/api/apis/{api['id']}")).status_code == 204
    assert (await user_client.get(f"/api/apis/{api['id']}")).status_code == 404


async def test_deleting_an_agent_unlinks_it_from_flows(user_client):
    api = await make_api(user_client)
    agent = await make_agent(user_client)
    flow = await make_flow(user_client, api["id"], agentIds=[agent])
    assert (await user_client.delete(f"/api/agents/{agent}")).status_code == 204
    assert (await user_client.get(f"/api/flows/{flow['id']}")).json()["agents"] == []


async def test_holds_plain_variables_next_to_secrets(user_client):
    api = await make_api(user_client, variables={"tenant": "acme", "version": "2"})
    assert api["variables"] == {"tenant": "acme", "version": "2"}
    updated = await user_client.patch(
        f"/api/apis/{api['id']}", json={"variables": {"version": None, "region": "eu"}}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["variables"] == {"region": "eu", "tenant": "acme"}
    # A name is a variable or a secret, never both.
    clash = await user_client.patch(f"/api/apis/{api['id']}", json={"variables": {"api_key": "x"}})
    assert clash.status_code == 422
    assert clash.json()["detail"] == [
        {
            "type": "value_error",
            "loc": ["body", "variables", "api_key"],
            "msg": "'api_key' is already a secret of this API",
        }
    ]
    assert SECRET not in clash.text


async def test_flows_may_use_variables_and_secrets_as_var(user_client):
    api = await make_api(user_client, variables={"tenant": "acme"})
    ok = await user_client.post(
        "/api/flows",
        json=flow_body(
            api["id"],
            inputs=[],
            steps=[
                {
                    "method": "GET",
                    "path": "/t/{{var.tenant}}",
                    "headers": [{"name": "k", "value": "{{var.api_key}}"}],
                }
            ],
        ),
    )
    assert ok.status_code == 201, ok.text
    unknown = await user_client.post(
        "/api/flows",
        json=flow_body(
            api["id"], name="Other", inputs=[], steps=[{"method": "GET", "path": "/{{var.nope}}"}]
        ),
    )
    assert unknown.status_code == 422
    assert unknown.json()["detail"][0]["msg"] == "the API has no variable named 'nope'"
