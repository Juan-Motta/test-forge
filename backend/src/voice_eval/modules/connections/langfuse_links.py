"""Links into Langfuse's UI for a Langfuse connection: a run's traces (by thread id) and one trace.

The thread's trace list (`{host}/project/{projectId}/traces?filter=…thread_id…`) needs the
project id, which only Langfuse knows: `LangfuseLinks.resolve` looks it up with the connection's
keys (`providers.langfuse_projects`) the first time it is needed and keeps it in memory, keyed
by the connection id and its `updated_at`, so an edited connection (another host or key) is
looked up again. A failed lookup is remembered for `failure_ttl_s` so an unreachable Langfuse
does not slow every request down; it never raises, the project id is just unknown. Only the host
and the project id are cached, never a key.
"""

import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import quote

from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.connections.domain import ConnectionKind, parse_config, reveal
from voice_eval.modules.connections.models import ConnectionRecord
from voice_eval.modules.connections.service import open_secrets
from voice_eval.platform.secrets import SecretBox
from voice_eval.providers.langfuse_projects import ProjectLookupError, fetch_project_id

log = logging.getLogger(__name__)

FAILURE_TTL_S = 60.0

ProjectLookup = Callable[..., Awaitable[str]]  # (host, public_key, secret_key, *, allow_private)


@dataclass(frozen=True)
class LangfuseProject:
    host: str  # without a trailing slash
    project_id: str | None  # None when Langfuse could not tell (unreachable, rejected the key)


@dataclass(frozen=True)
class _Entry:
    updated_at: datetime
    project_id: str | None
    retry_at: float | None  # failures only


def thread_traces_url(host: str, project_id: str, thread_id: str) -> str:
    """Langfuse's trace list filtered on `metadata.thread_id`: every trace (one per turn) of a
    run, the way the Langfuse UI writes that filter (`column;type;key;operator;value`)."""
    condition = f"metadata;stringObject;thread_id;=;{thread_id}"
    return (
        f"{host.rstrip('/')}/project/{quote(project_id, safe='')}"
        f"/traces?filter={quote(condition, safe='')}"
    )


def trace_url(host: str, trace_id: str) -> str:
    """One trace; Langfuse redirects `/trace/{id}` into the trace's project."""
    return f"{host.rstrip('/')}/trace/{quote(trace_id, safe='')}"


class LangfuseLinks:
    """Resolves a Langfuse connection to its host and project id, with an in-memory cache.

    `lookup` replaces the HTTP lookup (tests); `clock` is monotonic seconds.
    """

    def __init__(
        self,
        *,
        lookup: ProjectLookup = fetch_project_id,
        clock: Callable[[], float] = time.monotonic,
        failure_ttl_s: float = FAILURE_TTL_S,
    ) -> None:
        self.lookup = lookup
        self.clock = clock
        self.failure_ttl_s = failure_ttl_s
        self._entries: dict[uuid.UUID, _Entry] = {}

    async def resolve(
        self,
        db: AsyncSession,
        connection_id: uuid.UUID,
        *,
        secret_box: SecretBox,
        allow_local_http: bool = False,
        allow_private: bool = False,
    ) -> LangfuseProject | None:
        """None when `connection_id` is not a usable Langfuse connection; never raises."""
        record = await db.get(ConnectionRecord, connection_id)
        if record is None or record.kind != ConnectionKind.LANGFUSE.value:
            return None
        try:
            config = parse_config(
                ConnectionKind.LANGFUSE, record.config, allow_local_http=allow_local_http
            )
        except Exception:
            return None
        host = config.host.rstrip("/")
        entry = self._entries.get(connection_id)
        fresh = entry is not None and entry.updated_at == record.updated_at
        if fresh and (entry.retry_at is None or self.clock() < entry.retry_at):
            return LangfuseProject(host, entry.project_id)
        project_id = await self._lookup(
            record, config.host, config.public_key, secret_box, allow_private
        )
        retry_at = None if project_id is not None else self.clock() + self.failure_ttl_s
        self._entries[connection_id] = _Entry(record.updated_at, project_id, retry_at)
        return LangfuseProject(host, project_id)

    async def _lookup(
        self,
        record: ConnectionRecord,
        host: str,
        public_key: str,
        secret_box: SecretBox,
        allow_private: bool,
    ) -> str | None:
        try:
            secret_key = reveal(open_secrets(secret_box, record))["secret_key"]
            return await self.lookup(host, public_key, secret_key, allow_private=allow_private)
        except ProjectLookupError as exc:
            log.info("langfuse project unknown: %s", exc)
        except Exception as exc:  # never its text: it may quote a key
            log.warning("langfuse project lookup failed unexpectedly (%s)", type(exc).__name__)
        return None


default_links = LangfuseLinks()  # one cache per process
