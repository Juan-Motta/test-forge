"""Langfuse project lookup: the id of the project a public/secret key pair belongs to.

`GET {host}/api/public/projects` with a project-scoped key answers `{"data": [{"id": ...}]}`
with the key's own project. The id is what Langfuse's UI routes need
(`/project/{projectId}/sessions/{sessionId}`). The request goes through the egress guard like
the trace reader's, redirects are never followed, and every failure raises
`ProjectLookupError` whose message names the failure only, never a key or anything Langfuse
sent back.
"""

import base64
import logging

import httpx

from voice_eval.platform.egress import DestinationNotAllowed, Resolver, guarded_transport, resolve

log = logging.getLogger(__name__)

TIMEOUT_S = 5.0  # a link on the run report: never worth a long wait
PROJECT_ID_CHARS = 200


class ProjectLookupError(Exception):
    """The project could not be read; the message is safe to show and to log."""


async def fetch_project_id(
    host: str,
    public_key: str,
    secret_key: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    allow_private: bool = False,
    resolver: Resolver = resolve,
    timeout_s: float = TIMEOUT_S,
) -> str:
    """The id of the key's Langfuse project. Raises `ProjectLookupError`.

    `transport` replaces the network, egress guard included (tests use a mock).
    """
    pair = f"{public_key}:{secret_key}".encode()
    headers = {"Authorization": f"Basic {base64.b64encode(pair).decode()}"}
    url = f"{host.rstrip('/')}/api/public/projects"
    try:
        async with httpx.AsyncClient(
            transport=transport
            or guarded_transport(resolver=resolver, allow_private=allow_private),
            timeout=timeout_s,
            follow_redirects=False,
            trust_env=False,  # no proxy or .netrc from the environment
        ) as client:
            response = await client.get(url, headers=headers)
    except DestinationNotAllowed:
        raise ProjectLookupError(
            "Langfuse destination not allowed (not a public address)"
        ) from None
    except httpx.TimeoutException:
        raise ProjectLookupError(f"Langfuse timed out after {timeout_s:g} s") from None
    except (httpx.ConnectError, httpx.UnsupportedProtocol):
        raise ProjectLookupError("Could not connect to Langfuse (DNS, TLS or network)") from None
    except httpx.HTTPError as exc:
        raise ProjectLookupError(f"Langfuse request failed ({type(exc).__name__})") from None
    except Exception as exc:  # e.g. UnicodeEncodeError; its text may quote the secret
        log.warning("langfuse project lookup failed unexpectedly (%s)", type(exc).__name__)
        raise ProjectLookupError("Langfuse request failed (unexpected error)") from None

    if response.status_code != 200:
        raise ProjectLookupError(f"Unexpected response from Langfuse (HTTP {response.status_code})")
    try:
        body = response.json()
    except ValueError:
        raise ProjectLookupError("Langfuse answered something other than JSON") from None
    data = body.get("data") if isinstance(body, dict) else None
    first = data[0] if isinstance(data, list) and data else None
    project_id = first.get("id") if isinstance(first, dict) else None
    if not isinstance(project_id, str) or not project_id or len(project_id) > PROJECT_ID_CHARS:
        raise ProjectLookupError("Langfuse listed no project for this key")
    return project_id
