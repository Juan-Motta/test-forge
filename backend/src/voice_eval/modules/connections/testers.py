"""Connection tests: one cheap authenticated request per kind, reported as a sanitized status.

The response body is never read, redirects are never followed, and the detail never includes
anything the provider sent back or any secret, only the status code and a generic reason.
Requests only reach public addresses (see `platform.egress`), except in development.
"""

import base64
import logging
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import BaseModel

from voice_eval.modules.connections.domain import ConnectionKind, reveal
from voice_eval.platform.egress import DestinationNotAllowed, Resolver, guarded_transport, resolve

log = logging.getLogger(__name__)

TIMEOUT_S = 10.0


@dataclass(frozen=True)
class CheckResult:
    ok: bool
    detail: str


def _probe(kind: ConnectionKind, config: Any, secrets: BaseModel) -> dict[str, Any]:
    """`build_request` arguments that prove the credentials work (`config`: the kind's model)."""
    values = reveal(secrets)
    match kind:
        case ConnectionKind.OPENAI:
            return {
                "method": "GET",
                "url": f"{config.base_url}/models",
                "headers": {"Authorization": f"Bearer {values['api_key']}"},
            }
        case ConnectionKind.AZURE_OPENAI:
            return {
                "method": "GET",
                "url": f"{config.endpoint}/openai/models",
                "params": {"api-version": config.api_version},
                "headers": {"api-key": values["api_key"]},
            }
        case ConnectionKind.AZURE_SPEECH:
            base = config.endpoint or f"https://{config.region}.api.cognitive.microsoft.com"
            return {
                "method": "POST",
                "url": f"{base}/sts/v1.0/issueToken",
                "headers": {"Ocp-Apim-Subscription-Key": values["key"]},
                "content": b"",
            }
        case ConnectionKind.LANGFUSE:
            pair = f"{config.public_key}:{values['secret_key']}".encode()
            return {
                "method": "GET",
                "url": f"{config.host}/api/public/projects",
                "headers": {"Authorization": f"Basic {base64.b64encode(pair).decode()}"},
            }


def _describe(status: int) -> CheckResult:
    if 200 <= status < 300:
        return CheckResult(True, f"Connected (HTTP {status})")
    if 300 <= status < 400:
        return CheckResult(False, f"Unexpected redirect (HTTP {status}); check the URL")
    if status in (401, 403):
        return CheckResult(False, f"Authentication failed (HTTP {status})")
    if status == 404:
        return CheckResult(False, f"Endpoint not found (HTTP {status}); check the URL")
    if status == 429:
        return CheckResult(False, f"Rate limited by the provider (HTTP {status})")
    if status >= 500:
        return CheckResult(False, f"Provider error (HTTP {status})")
    return CheckResult(False, f"Unexpected response (HTTP {status})")


class ConnectionTester:
    """Runs connection tests.

    `transport` replaces the network, egress guard included (tests use a mock); `resolver`
    replaces DNS resolution for the guard. `allow_private_destinations` lifts the guard
    (development only, to test local services).
    """

    def __init__(
        self,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_s: float = TIMEOUT_S,
        allow_private_destinations: bool = False,
        resolver: Resolver = resolve,
    ) -> None:
        self.transport = transport
        self.timeout_s = timeout_s
        self.allow_private_destinations = allow_private_destinations
        self.resolver = resolver

    def _transport(self) -> httpx.AsyncBaseTransport:
        if self.transport is not None:
            return self.transport
        return guarded_transport(
            resolver=self.resolver, allow_private=self.allow_private_destinations
        )

    async def check(self, kind: ConnectionKind, config: Any, secrets: BaseModel) -> CheckResult:
        """Never raises: every failure is a `CheckResult` whose detail holds no secret."""
        try:
            async with httpx.AsyncClient(
                transport=self._transport(),
                timeout=self.timeout_s,
                follow_redirects=False,
                trust_env=False,  # no proxy or .netrc from the environment
            ) as client:
                request = client.build_request(**_probe(kind, config, secrets))
                response = await client.send(request, stream=True)
                await response.aclose()  # the body is never read
        except DestinationNotAllowed:
            return CheckResult(False, "Destination not allowed (not a public address)")
        except httpx.TimeoutException:
            return CheckResult(False, f"Timed out after {self.timeout_s:g} s")
        except (httpx.ConnectError, httpx.UnsupportedProtocol):
            return CheckResult(False, "Could not connect (DNS, TLS or network error)")
        except httpx.HTTPError as exc:
            return CheckResult(False, f"Request failed ({type(exc).__name__})")
        except Exception as exc:  # e.g. UnicodeEncodeError; its text may quote the secret
            log.warning("connection test failed unexpectedly (%s)", type(exc).__name__)
            return CheckResult(False, "Request failed (unexpected error)")
        return _describe(response.status_code)
