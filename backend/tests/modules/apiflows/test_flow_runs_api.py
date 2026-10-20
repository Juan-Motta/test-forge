import copy
import json
import uuid

import httpx
import pytest
from test_apiflows_api import INPUTS, SECRET, STEPS, make_api, make_flow

from voice_eval.modules.apiflows.domain import Header, Step
from voice_eval.modules.apiflows.runner import run_flow
from voice_eval.platform.egress import guarded_transport

TOKEN = "jwt-abc.def.ghi"


class FakeShop:
    """The API behind the flows: records what it receives and answers like a shop."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.token_status = 200
        self.items = [{"sku": "LIN-204", "price": 89.0}]

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/v1/auth/token":
            if request.headers.get("x-api-key") != SECRET:
                return httpx.Response(401, json={"detail": "bad key"})
            # Echoes the key back, as some APIs do: records must hide it.
            body = {"access_token": TOKEN, "key": SECRET}
            return httpx.Response(self.token_status, json=body)
        if request.url.path == "/v1/products/search":
            if request.headers.get("authorization") != f"Bearer {TOKEN}":
                return httpx.Response(401, json={"detail": "no token"})
            return httpx.Response(200, json={"items": self.items, "total": len(self.items)})
        if request.url.path == "/v1/orders":
            return httpx.Response(201, json={"received": json.loads(request.content)})
        return httpx.Response(404, text="not here")


@pytest.fixture
def shop(app) -> FakeShop:
    fake = FakeShop()
    app.state.flow_runner.transport = lambda: httpx.MockTransport(fake.handler)
    return fake


@pytest.fixture
def generated(app) -> list:
    """AI stub: writes `generated <name>` for each input it is asked for."""
    asked: list = []

    async def factory(db, flow, connection_id):
        async def generate(items):
            asked.append([item.name for item in items])
            return {item.name: f"generated {item.name}" for item in items}

        return generate

    app.state.flow_runner.build_generator = factory
    return asked


async def run(client, flow_id: str, **body) -> httpx.Response:
    return await client.post(f"/api/flows/{flow_id}/runs", json=body)


async def test_runs_every_step_passing_saved_values_on(user_client, shop, generated):
    api = await make_api(user_client)
    flow = await make_flow(user_client, api["id"])
    response = await run(user_client, flow["id"], inputs={"query": "linen"})
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["status"] == "passed"
    assert result["inputs"] == [
        {"name": "query", "value": "linen", "source": "given"},
        {"name": "max_price", "value": 120, "source": "default"},
    ]
    assert generated == []  # nothing left to write
    first, second = result["steps"]
    assert (first["status"], second["status"]) == ("passed", "passed")
    assert first["saved"] == {"token": TOKEN}
    assert [check["passed"] for check in second["checks"]] == [True, True]
    assert second["checks"][0]["actual"] == 1

    sent_search = shop.requests[1]
    assert sent_search.url.params["q"] == "linen"
    assert sent_search.url.params["max"] == "120"
    assert sent_search.headers["accept"] == "application/json"  # the API's own header

    # Secrets never reach the record: the request keeps the placeholder, the echo is hidden.
    assert first["request"]["headers"][1] == {"name": "x-api-key", "value": "{{secret.api_key}}"}
    assert first["response"]["body"]["key"] == "{{secret.api_key}}"
    assert SECRET not in response.text
    stored = await user_client.get(f"/api/flow-runs/{result['id']}")
    assert stored.json() == result


async def test_ai_writes_inputs_that_have_no_value(user_client, shop, generated):
    api = await make_api(user_client)
    flow = await make_flow(user_client, api["id"])
    result = (await run(user_client, flow["id"])).json()
    assert generated == [["query"]]
    assert result["inputs"][0] == {
        "name": "query",
        "value": "generated query",
        "source": "generated",
    }
    assert shop.requests[1].url.params["q"] == "generated query"


async def test_refuses_generated_inputs_without_a_chat_connection(user_client, shop):
    api = await make_api(user_client)
    flow = await make_flow(user_client, api["id"])
    response = await run(user_client, flow["id"])
    assert response.status_code == 422
    assert response.json()["detail"] == [
        {
            "type": "value_error",
            "loc": ["body", "inputs", "query"],
            "msg": "a value is required: no chat connection can write it",
        }
    ]
    assert shop.requests == []


@pytest.mark.parametrize(
    ("inputs", "loc", "msg"),
    [
        (
            {"query": "x", "colour": "red"},
            ["body", "inputs", "colour"],
            "the flow has no such input",
        ),
        ({"query": "x", "max_price": "cheap"}, ["body", "inputs", "max_price"], "must be a number"),
    ],
)
async def test_refuses_unusable_inputs(user_client, shop, inputs, loc, msg):
    api = await make_api(user_client)
    flow = await make_flow(user_client, api["id"])
    response = await run(user_client, flow["id"], inputs=inputs)
    assert response.status_code == 422
    assert {"type": "value_error", "loc": loc, "msg": msg} in response.json()["detail"]
    assert shop.requests == []


async def test_stops_at_the_first_failed_step(user_client, shop):
    shop.token_status = 500
    api = await make_api(user_client)
    flow = await make_flow(user_client, api["id"])
    response = await run(user_client, flow["id"], inputs={"query": "linen"})
    assert response.status_code == 201
    result = response.json()
    assert result["status"] == "failed"
    first, second = result["steps"]
    assert first["status"] == "failed"
    assert first["checks"] == [
        {"check": {"type": "status", "equals": 200}, "passed": False, "actual": 500}
    ]
    assert (second["status"], second["request"], second["response"]) == ("skipped", None, None)
    assert len(shop.requests) == 1


async def test_a_value_that_cannot_be_saved_fails_the_step(user_client, shop):
    api = await make_api(user_client)
    steps = copy.deepcopy(STEPS)
    steps[0]["saves"] = [{"name": "token", "path": "body.jwt"}]
    flow = await make_flow(user_client, api["id"], steps=steps)
    result = (await run(user_client, flow["id"], inputs={"query": "x"})).json()
    assert result["steps"][0]["status"] == "failed"
    assert result["steps"][0]["error"] == "could not save token (body.jwt not found)"
    assert result["steps"][1]["status"] == "skipped"


async def test_a_whole_placeholder_keeps_its_type_in_the_body(user_client, shop):
    api = await make_api(user_client)
    steps = [
        {
            "method": "POST",
            "path": "/orders",
            "body": {"max": "{{input.max_price}}", "note": "up to {{input.max_price}}"},
            "checks": [{"type": "path", "path": "body.received.max", "op": "==", "value": 120}],
        }
    ]
    flow = await make_flow(user_client, api["id"], inputs=INPUTS[1:], steps=steps)
    result = (await run(user_client, flow["id"])).json()
    assert json.loads(shop.requests[0].content) == {"max": 120, "note": "up to 120"}
    assert result["status"] == "passed"


async def test_a_connection_failure_fails_the_step_with_a_safe_message(app, user_client):
    def refuse(request):
        raise httpx.ConnectError("boom at https://api.shop.example/v1", request=request)

    app.state.flow_runner.transport = lambda: httpx.MockTransport(refuse)
    api = await make_api(user_client)
    flow = await make_flow(user_client, api["id"])
    result = (await run(user_client, flow["id"], inputs={"query": "x"})).json()
    assert result["steps"][0]["error"] == "could not connect to the API"


async def test_the_egress_guard_refuses_private_destinations():
    async with httpx.AsyncClient(transport=guarded_transport(allow_private=False)) as client:
        outcome = await run_flow(
            base_url="http://127.0.0.1:9",
            headers=[Header(name="Accept", value="*/*")],
            secrets={},
            steps=[Step.model_validate({"method": "GET", "path": "/"})],
            inputs=[],
            client=client,
        )
    assert outcome.steps[0].error == "the destination is not allowed (private or local network)"
    assert outcome.status == "failed"


async def test_lists_runs_newest_first(user_client, shop):
    api = await make_api(user_client)
    flow = await make_flow(user_client, api["id"])
    first = (await run(user_client, flow["id"], inputs={"query": "a"})).json()
    second = (await run(user_client, flow["id"], inputs={"query": "b"})).json()
    listed = (await user_client.get(f"/api/flows/{flow['id']}/runs")).json()
    assert [r["id"] for r in listed] == [second["id"], first["id"]]
    assert (await user_client.get(f"/api/flows/{flow['id']}/runs", params={"limit": 1})).json()[0][
        "id"
    ] == second["id"]
    assert (await user_client.get(f"/api/flows/{uuid.uuid4()}/runs")).status_code == 404
    assert (await user_client.get(f"/api/flow-runs/{uuid.uuid4()}")).status_code == 404


async def test_a_run_step_as_curl_masked_or_revealed(user_client, shop):
    api = await make_api(user_client)
    flow = await make_flow(user_client, api["id"])
    result = (await run(user_client, flow["id"], inputs={"query": "linen"})).json()
    url = f"/api/flow-runs/{result['id']}/steps/0/curl"
    masked = (await user_client.get(url)).json()["curl"]
    assert masked == (
        "curl -X POST https://api.shop.example/v1/auth/token \\\n"
        "  -H 'Accept: application/json' \\\n"
        "  -H 'x-api-key: ••••cdef' \\\n"
        "  -H 'Content-Type: application/json' \\\n"
        '  --data-raw \'{"scope": "catalog:read"}\''
    )
    revealed = (await user_client.get(url, params={"reveal": "true"})).json()["curl"]
    assert f"x-api-key: {SECRET}" in revealed
    search = (await user_client.get(f"/api/flow-runs/{result['id']}/steps/1/curl")).json()
    assert f"Authorization: Bearer {TOKEN}" in search["curl"]
    missing = await user_client.get(f"/api/flow-runs/{result['id']}/steps/5/curl")
    assert missing.status_code == 404


async def test_a_flow_as_curl_before_running_it(user_client):
    api = await make_api(user_client)
    flow = await make_flow(user_client, api["id"])
    steps = (
        await user_client.get(f"/api/flows/{flow['id']}/curl", params={"query": "linen"})
    ).json()["steps"]
    assert len(steps) == 2
    assert "x-api-key: ••••cdef" in steps[0]["curl"]
    assert "q=linen&max=120" in steps[1]["curl"]
    # Only a run knows the token.
    assert "Authorization: Bearer {{saved.token}}" in steps[1]["curl"]
    revealed = (
        await user_client.get(f"/api/flows/{flow['id']}/curl", params={"reveal": "true"})
    ).json()["steps"]
    assert f"x-api-key: {SECRET}" in revealed[0]["curl"]
    assert "q=%7B%7Binput.query%7D%7D" in revealed[1]["curl"]


async def test_runs_require_authentication(client):
    some = uuid.uuid4()
    assert (await client.post(f"/api/flows/{some}/runs", json={})).status_code == 401
    assert (await client.get(f"/api/flows/{some}/runs")).status_code == 401
    assert (await client.get(f"/api/flows/{some}/curl")).status_code == 401
    assert (await client.get(f"/api/flow-runs/{some}")).status_code == 401
    assert (await client.get(f"/api/flow-runs/{some}/steps/0/curl")).status_code == 401
