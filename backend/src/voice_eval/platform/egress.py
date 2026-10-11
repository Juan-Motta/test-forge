"""Outbound HTTP guard against server-side request forgery (SSRF).

Connection tests send a request to a URL the user typed. Without a guard, that URL could point
at the backend's own network: loopback services, private ranges or the cloud metadata endpoint.

`GuardedNetworkBackend` sits where the HTTP client opens its TCP connection. It resolves the
host once, refuses the connection unless every resolved address is public, then connects to
one of those vetted addresses (never to the name again), so DNS rebinding between the check and
the connection is not possible. TLS still verifies the certificate against the host name.
"""

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable, Iterable

import httpcore
import httpx

Resolver = Callable[[str, int], Awaitable[list[str]]]


class DestinationNotAllowed(Exception):
    """The destination resolves to a loopback, private, link-local or otherwise non-public IP."""


def is_public(address: str) -> bool:
    """Whether `address` is a globally routable unicast address (IPv4-mapped IPv6 unwrapped)."""
    ip = ipaddress.ip_address(address.partition("%")[0])  # drop an IPv6 zone id
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


async def resolve(host: str, port: int) -> list[str]:
    """The addresses `host` resolves to (an IP literal resolves to itself), without duplicates."""
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


class GuardedNetworkBackend(httpcore.AsyncNetworkBackend):
    """Resolve, vet, then connect to a vetted address. `allow_private` skips the vetting."""

    def __init__(
        self,
        *,
        resolver: Resolver = resolve,
        inner: httpcore.AsyncNetworkBackend | None = None,
        allow_private: bool = False,
    ) -> None:
        self._resolver = resolver
        self._inner = inner or httpcore.AnyIOBackend()
        self._allow_private = allow_private

    async def _addresses(self, host: str, port: int, limit_s: float | None) -> list[str]:
        try:
            async with asyncio.timeout(limit_s):
                addresses = await self._resolver(host, port)
        except TimeoutError:
            raise httpcore.ConnectTimeout("name resolution timed out") from None
        except OSError:
            raise httpcore.ConnectError("name resolution failed") from None
        if not addresses:
            raise httpcore.ConnectError("name resolution returned no address")
        if not self._allow_private and not all(is_public(address) for address in addresses):
            raise DestinationNotAllowed("destination is not a public address")
        return addresses

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109 - httpcore's interface
        local_address: str | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        loop = asyncio.get_running_loop()
        deadline = None if timeout is None else loop.time() + timeout

        def remaining() -> float | None:
            return None if deadline is None else deadline - loop.time()

        # One budget for the resolution and every connect attempt, not `timeout` per step.
        addresses = await self._addresses(host, port, timeout)
        last_error: Exception = httpcore.ConnectError("could not connect")
        for address in addresses:
            left = remaining()
            if left is not None and left <= 0:
                raise httpcore.ConnectTimeout("connection timed out")
            try:
                return await self._inner.connect_tcp(
                    address,
                    port,
                    timeout=left,
                    local_address=local_address,
                    socket_options=socket_options,
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                last_error = exc
        raise last_error

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,  # noqa: ASYNC109 - httpcore's interface
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        raise DestinationNotAllowed("unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


def guarded_transport(
    *, resolver: Resolver = resolve, allow_private: bool = False
) -> httpx.AsyncHTTPTransport:
    """An httpx transport whose connections go through `GuardedNetworkBackend`.

    httpx 0.28 has no public option for the network backend, so the connection pool it builds is
    replaced by an equivalent one (default TLS verification, HTTP/1.1, no retries) that uses the
    guard. `tests/platform/test_egress.py` proves the guard is really in the path.
    """
    transport = httpx.AsyncHTTPTransport(trust_env=False)
    transport._pool = httpcore.AsyncConnectionPool(
        ssl_context=httpx.create_ssl_context(),
        network_backend=GuardedNetworkBackend(resolver=resolver, allow_private=allow_private),
    )
    return transport
