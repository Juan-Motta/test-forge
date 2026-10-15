"""Langfuse project lookup (mocked HTTP, never the network): the project of an API key."""

import base64

import httpx
import pytest

from voice_eval.providers.langfuse_projects import ProjectLookupError, fetch_project_id

HOST = "https://cloud.langfuse.com/"
PUBLIC = "pk-lf-public"
SECRET = "sk-lf-very-secret-value"


async def lookup(handler) -> str:
    return await fetch_project_id(HOST, PUBLIC, SECRET, transport=httpx.MockTransport(handler))


async def test_reads_the_key_project_with_basic_auth():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": "proj-1", "name": "Vivi"}]})

    assert await lookup(handler) == "proj-1"
    assert [str(request.url) for request in requests] == [
        "https://cloud.langfuse.com/api/public/projects"
    ]
    expected = base64.b64encode(f"{PUBLIC}:{SECRET}".encode()).decode()
    assert requests[0].headers["Authorization"] == f"Basic {expected}"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(401, json={"message": SECRET}),
        httpx.Response(500, text=SECRET),
        httpx.Response(302, headers={"location": "https://elsewhere.example"}),
        httpx.Response(200, json={"data": []}),
        httpx.Response(200, json={"data": [{"name": "no id"}]}),
        httpx.Response(200, json=["not", "an", "object"]),
        httpx.Response(200, text=f"not json {SECRET}"),
    ],
)
async def test_unusable_answers_raise_a_safe_error(response):
    with pytest.raises(ProjectLookupError) as caught:
        await lookup(lambda _request: response)
    assert SECRET not in str(caught.value)
    assert PUBLIC not in str(caught.value)


async def test_network_errors_raise_a_safe_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"boom {SECRET}", request=request)

    with pytest.raises(ProjectLookupError) as caught:
        await lookup(handler)
    assert SECRET not in str(caught.value)
