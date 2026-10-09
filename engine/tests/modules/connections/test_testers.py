import base64

import httpx
import pytest

from voice_eval.modules.connections.domain import ConnectionKind, parse_config, parse_secrets
from voice_eval.modules.connections.testers import CheckResult, ConnectionTester

SECRET = "sk-very-secret-value-1234"

CASES = {
    "openai": ({"baseUrl": "https://api.openai.com/v1"}, {"apiKey": SECRET}),
    "azure_openai": (
        {
            "endpoint": "https://res.openai.azure.com",
            "apiVersion": "2025-03-01-preview",
            "ttsDeployment": "tts",
        },
        {"apiKey": SECRET},
    ),
    "azure_speech": ({"region": "eastus"}, {"key": SECRET}),
    "langfuse": (
        {"host": "https://cloud.langfuse.com", "publicKey": "pk-lf-1"},
        {"secretKey": SECRET},
    ),
}


class Recorder:
    def __init__(self, status: int = 200, body: bytes = b"{}", headers=None, exc=None):
        self.requests: list[httpx.Request] = []
        self.status, self.body, self.headers, self.exc = status, body, headers or {}, exc

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.exc is not None:
            raise self.exc
        return httpx.Response(self.status, content=self.body, headers=self.headers)


async def run(kind: str, recorder: Recorder, config=None) -> CheckResult:
    raw_config, raw_secrets = CASES[kind]
    k = ConnectionKind(kind)
    tester = ConnectionTester(transport=httpx.MockTransport(recorder))
    return await tester.check(
        k,
        parse_config(k, config or raw_config, allow_local_http=False),
        parse_secrets(k, raw_secrets),
    )


async def test_openai_lists_models_with_bearer():
    recorder = Recorder()
    outcome = await run("openai", recorder)
    assert outcome == CheckResult(ok=True, detail="Connected (HTTP 200)")
    (request,) = recorder.requests
    assert (request.method, str(request.url)) == ("GET", "https://api.openai.com/v1/models")
    assert request.headers["authorization"] == f"Bearer {SECRET}"
    assert request.extensions["timeout"] == dict.fromkeys(("connect", "read", "write", "pool"), 10)


async def test_azure_openai_lists_models_with_api_key_header():
    recorder = Recorder()
    assert (await run("azure_openai", recorder)).ok
    (request,) = recorder.requests
    assert request.method == "GET"
    assert str(request.url) == (
        "https://res.openai.azure.com/openai/models?api-version=2025-03-01-preview"
    )
    assert request.headers["api-key"] == SECRET
    assert "authorization" not in request.headers


async def test_azure_speech_issues_a_token_by_region_or_endpoint():
    recorder = Recorder()
    assert (await run("azure_speech", recorder)).ok
    assert (
        await run("azure_speech", recorder, {"endpoint": "https://res.cognitiveservices.azure.com"})
    ).ok
    by_region, by_endpoint = recorder.requests
    assert by_region.method == by_endpoint.method == "POST"
    assert str(by_region.url) == "https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    assert str(by_endpoint.url) == "https://res.cognitiveservices.azure.com/sts/v1.0/issueToken"
    assert by_region.headers["ocp-apim-subscription-key"] == SECRET


async def test_langfuse_uses_basic_auth():
    recorder = Recorder()
    assert (await run("langfuse", recorder)).ok
    (request,) = recorder.requests
    assert str(request.url) == "https://cloud.langfuse.com/api/public/projects"
    expected = base64.b64encode(f"pk-lf-1:{SECRET}".encode()).decode()
    assert request.headers["authorization"] == f"Basic {expected}"


@pytest.mark.parametrize(
    ("status", "detail"),
    [
        (401, "Authentication failed (HTTP 401)"),
        (403, "Authentication failed (HTTP 403)"),
        (404, "Endpoint not found (HTTP 404); check the URL"),
        (429, "Rate limited by the provider (HTTP 429)"),
        (500, "Provider error (HTTP 500)"),
        (418, "Unexpected response (HTTP 418)"),
    ],
)
async def test_failures_are_sanitized_status_messages(status, detail):
    body = f'{{"error": "invalid key {SECRET}", "trace": "internal"}}'.encode()
    outcome = await run("openai", Recorder(status, body))
    assert outcome == CheckResult(ok=False, detail=detail)


async def test_redirects_are_reported_not_followed():
    recorder = Recorder(302, headers={"location": "https://elsewhere.example/steal"})
    outcome = await run("openai", recorder)
    assert outcome == CheckResult(ok=False, detail="Unexpected redirect (HTTP 302); check the URL")
    assert len(recorder.requests) == 1


@pytest.mark.parametrize(
    ("exc", "detail"),
    [
        (httpx.ConnectTimeout("t"), "Timed out after 10 s"),
        (httpx.ReadTimeout("t"), "Timed out after 10 s"),
        (httpx.ConnectError(f"boom {SECRET}"), "Could not connect (DNS, TLS or network error)"),
        (httpx.RemoteProtocolError(f"bad {SECRET}"), "Request failed (RemoteProtocolError)"),
    ],
)
async def test_network_errors_are_sanitized(exc, detail):
    assert await run("openai", Recorder(exc=exc)) == CheckResult(ok=False, detail=detail)


def test_default_client_settings():
    tester = ConnectionTester()
    assert tester.timeout_s == 10
