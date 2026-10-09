"""Outbound guard for connection tests: only public addresses, pinned to the vetted address."""

import httpcore
import pytest

from voice_eval.modules.connections.api import connection_tester
from voice_eval.modules.connections.domain import ConnectionKind, parse_config, parse_secrets
from voice_eval.modules.connections.testers import CheckResult, ConnectionTester
from voice_eval.platform.egress import DestinationNotAllowed, GuardedNetworkBackend, is_public
from voice_eval.platform.settings import Settings

SECRET = "sk-proj-abcdefghijklmnop1234"
DB_URL = "postgresql+asyncpg://u:p@localhost:5432/db"
PUBLIC_V4 = "93.184.216.34"
PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946"


def resolver_for(*addresses: str):
    calls: list[tuple[str, int]] = []

    async def resolve(host: str, port: int) -> list[str]:
        calls.append((host, port))
        return list(addresses)

    resolve.calls = calls
    return resolve


class RecordingBackend(httpcore.AsyncNetworkBackend):
    """Stands in for the socket layer: records where it was asked to connect, then refuses."""

    def __init__(self) -> None:
        self.connected: list[tuple[str, int]] = []

    async def connect_tcp(
        self,
        host,
        port,
        timeout=None,  # noqa: ASYNC109 - httpcore's interface
        local_address=None,
        socket_options=None,
    ):
        self.connected.append((host, port))
        raise httpcore.ConnectError("refused by the test backend")

    async def sleep(self, seconds: float) -> None:
        return None


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",  # loopback
        "10.1.2.3",  # private
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",  # link-local (cloud metadata)
        "224.0.0.1",  # multicast
        "240.0.0.1",  # reserved
        "0.0.0.0",  # unspecified
        "100.64.0.1",  # shared address space (carrier-grade NAT)
        "::1",
        "::",
        "fe80::1",
        "fc00::1",
        "ff02::1",
        "::ffff:127.0.0.1",  # IPv4-mapped loopback
        "::ffff:10.0.0.1",
    ],
)
def test_non_public_addresses_are_refused(address):
    assert is_public(address) is False


@pytest.mark.parametrize("address", [PUBLIC_V4, PUBLIC_V6, "8.8.8.8", "::ffff:8.8.8.8"])
def test_public_addresses_are_allowed(address):
    assert is_public(address) is True


async def test_backend_refuses_a_host_resolving_to_a_private_address():
    inner = RecordingBackend()
    backend = GuardedNetworkBackend(resolver=resolver_for("10.0.0.5"), inner=inner)
    with pytest.raises(DestinationNotAllowed):
        await backend.connect_tcp("internal.example.com", 443)
    assert inner.connected == []


async def test_backend_refuses_when_any_resolved_address_is_private():
    inner = RecordingBackend()
    backend = GuardedNetworkBackend(resolver=resolver_for(PUBLIC_V4, "127.0.0.1"), inner=inner)
    with pytest.raises(DestinationNotAllowed):
        await backend.connect_tcp("mixed.example.com", 443)
    assert inner.connected == []


async def test_backend_connects_to_the_vetted_address_not_the_name():
    inner = RecordingBackend()
    resolve = resolver_for(PUBLIC_V4, PUBLIC_V6)
    backend = GuardedNetworkBackend(resolver=resolve, inner=inner)
    with pytest.raises(httpcore.ConnectError):
        await backend.connect_tcp("api.example.com", 443)
    assert resolve.calls == [("api.example.com", 443)]
    assert inner.connected == [(PUBLIC_V4, 443), (PUBLIC_V6, 443)]  # each tried, never the name


async def test_backend_allows_private_addresses_when_told_to():
    inner = RecordingBackend()
    backend = GuardedNetworkBackend(
        resolver=resolver_for("127.0.0.1"), inner=inner, allow_private=True
    )
    with pytest.raises(httpcore.ConnectError):
        await backend.connect_tcp("localhost", 8080)
    assert inner.connected == [("127.0.0.1", 8080)]


async def test_resolution_failure_is_a_connect_error():
    async def broken(host: str, port: int) -> list[str]:
        raise OSError("name or service not known")

    backend = GuardedNetworkBackend(resolver=broken, inner=RecordingBackend())
    with pytest.raises(httpcore.ConnectError):
        await backend.connect_tcp("nowhere.invalid", 443)


async def check(tester: ConnectionTester, base_url: str) -> CheckResult:
    kind = ConnectionKind.OPENAI
    config = parse_config(kind, {"baseUrl": base_url}, allow_local_http=True)
    return await tester.check(kind, config, parse_secrets(kind, {"apiKey": SECRET}))


async def test_tester_refuses_private_destinations_with_a_sanitized_detail():
    tester = ConnectionTester(resolver=resolver_for("169.254.169.254"))
    outcome = await check(tester, "https://metadata.example.com/v1")
    assert outcome == CheckResult(False, "Destination not allowed (not a public address)")


async def test_tester_refuses_ip_literals_of_private_ranges():
    tester = ConnectionTester()  # the real resolver: an IP literal resolves to itself
    outcome = await check(tester, "http://127.0.0.1:9")
    assert outcome == CheckResult(False, "Destination not allowed (not a public address)")


async def test_tester_in_development_may_reach_local_services():
    tester = ConnectionTester(allow_private_destinations=True)
    outcome = await check(tester, "http://127.0.0.1:9")  # discard port: nothing listens
    assert outcome == CheckResult(False, "Could not connect (DNS, TLS or network error)")


def test_api_tester_allows_private_destinations_only_in_development():
    production = Settings(_env_file=None, database_url=DB_URL, environment="production")
    development = Settings(_env_file=None, database_url=DB_URL, environment="development")
    assert connection_tester(production).allow_private_destinations is False
    assert connection_tester(development).allow_private_destinations is True
