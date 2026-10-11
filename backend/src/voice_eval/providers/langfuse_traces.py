"""Langfuse trace reader: the agent's observations for one session, and a digest for the judge.

`LangfuseTraceReader` reads `GET /api/public/v2/observations` (the v1 read APIs are deprecated)
for one `sessionId` inside a time window, following the response cursor, and returns the raw
observations in chronological order. Requests go through the egress guard like connection
tests do, redirects are never followed, and errors raise `TraceFetchError` whose message names
the failure only, never a key or anything the provider sent back.

`digest_observations` turns raw observations into a bounded, LLM-friendly structure: traces in
chronological order with offsets relative to the run start, per-observation timings, models,
usage, errors and truncated input/output, plus aggregate stats. Every observation field is
treated as optional; unknown types and shapes are tolerated.
"""

import asyncio
import base64
import json
import logging
import statistics
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from voice_eval.platform.egress import DestinationNotAllowed, Resolver, guarded_transport, resolve

log = logging.getLogger(__name__)

TIMEOUT_S = 30.0
PAGE_LIMIT = 1000
MAX_PAGES = 50  # 50k observations: far beyond one call; only guards against a cursor loop
MAX_RETRIES = 3  # per page, on HTTP 429
MAX_RETRY_WAIT_S = 30.0
DEFAULT_RETRY_WAIT_S = 2.0
FIELDS = "core,basic,time,io,metadata,model,usage,metrics,trace_context"

IO_CHARS = 1500  # tool calls, spans and events
GENERATION_IO_CHARS = 600  # generation prompts are long and repeat across turns
BUDGET_CHARS = 120_000

Sleep = Callable[[float], Awaitable[None]]


class TraceFetchError(Exception):
    """Observations could not be read; the message is safe to show and to log."""


def _iso(moment: datetime) -> str:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def _retry_wait(response: httpx.Response) -> float:
    """Seconds to wait from `Retry-After` (seconds or an HTTP date), bounded."""
    header = response.headers.get("retry-after", "").strip()
    wait = DEFAULT_RETRY_WAIT_S
    if header:
        try:
            wait = float(header)
        except ValueError:
            try:
                wait = (parsedate_to_datetime(header) - datetime.now(UTC)).total_seconds()
            except (TypeError, ValueError):
                wait = DEFAULT_RETRY_WAIT_S
    return min(max(wait, 0.0), MAX_RETRY_WAIT_S)


def _status_error(status: int) -> TraceFetchError:
    if status in (401, 403):
        return TraceFetchError(f"Langfuse authentication failed (HTTP {status})")
    if status == 404:
        return TraceFetchError(f"Langfuse endpoint not found (HTTP {status}); check the host")
    if status == 429:
        return TraceFetchError(f"Langfuse rate limit persisted (HTTP {status})")
    if 300 <= status < 400:
        return TraceFetchError(f"Unexpected redirect from Langfuse (HTTP {status})")
    if status >= 500:
        return TraceFetchError(f"Langfuse server error (HTTP {status})")
    return TraceFetchError(f"Unexpected response from Langfuse (HTTP {status})")


class LangfuseTraceReader:
    """Reads one session's observations from Langfuse.

    `transport` replaces the network, egress guard included (tests use a mock); `resolver`
    replaces DNS resolution for the guard; `allow_private` lifts the guard (development only).
    `sleep` is awaited between rate-limited attempts.
    """

    def __init__(
        self,
        host: str,
        public_key: str,
        secret_key: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        allow_private: bool = False,
        resolver: Resolver = resolve,
        timeout_s: float = TIMEOUT_S,
        sleep: Sleep = asyncio.sleep,
        max_pages: int = MAX_PAGES,
    ) -> None:
        self.host = host.rstrip("/")
        self.public_key = public_key
        self.transport = transport
        self.allow_private = allow_private
        self.resolver = resolver
        self.timeout_s = timeout_s
        self.sleep = sleep
        self.max_pages = max_pages
        pair = f"{public_key}:{secret_key}".encode()
        self._authorization = f"Basic {base64.b64encode(pair).decode()}"

    def __repr__(self) -> str:
        return f"LangfuseTraceReader(host={self.host!r}, public_key={self.public_key!r})"

    def _transport(self) -> httpx.AsyncBaseTransport:
        if self.transport is not None:
            return self.transport
        return guarded_transport(resolver=self.resolver, allow_private=self.allow_private)

    async def fetch_session(
        self, session_id: str, *, start: datetime, end: datetime
    ) -> list[dict[str, Any]]:
        """Every observation of `session_id` that started in [start, end], oldest first."""
        base_params = {
            "sessionId": session_id,
            "fromStartTime": _iso(start),
            "toStartTime": _iso(end),
            "fields": FIELDS,
            "limit": str(PAGE_LIMIT),
        }
        found: dict[str, dict[str, Any]] = {}
        anonymous: list[dict[str, Any]] = []
        try:
            async with httpx.AsyncClient(
                transport=self._transport(),
                timeout=self.timeout_s,
                follow_redirects=False,
                trust_env=False,  # no proxy or .netrc from the environment
            ) as client:
                cursor: str | None = None
                seen_cursors: set[str] = set()
                for _ in range(self.max_pages):
                    params = (
                        dict(base_params) if cursor is None else {**base_params, "cursor": cursor}
                    )
                    data, cursor = await self._page(client, params)
                    for observation in data:
                        key = observation.get("id")
                        if isinstance(key, str) and key:
                            found[key] = observation
                        else:
                            anonymous.append(observation)
                    if not cursor or cursor in seen_cursors:
                        break
                    seen_cursors.add(cursor)
                else:
                    log.warning("langfuse pagination stopped after %d pages", self.max_pages)
        except TraceFetchError:
            raise
        except DestinationNotAllowed:
            raise TraceFetchError(
                "Langfuse destination not allowed (not a public address)"
            ) from None
        except httpx.TimeoutException:
            raise TraceFetchError(f"Langfuse timed out after {self.timeout_s:g} s") from None
        except (httpx.ConnectError, httpx.UnsupportedProtocol):
            raise TraceFetchError("Could not connect to Langfuse (DNS, TLS or network)") from None
        except httpx.HTTPError as exc:
            raise TraceFetchError(f"Langfuse request failed ({type(exc).__name__})") from None
        except Exception as exc:  # e.g. UnicodeEncodeError; its text may quote the secret
            log.warning("langfuse fetch failed unexpectedly (%s)", type(exc).__name__)
            raise TraceFetchError("Langfuse request failed (unexpected error)") from None
        return sort_observations([*found.values(), *anonymous])

    async def _page(
        self, client: httpx.AsyncClient, params: dict[str, str]
    ) -> tuple[list[dict[str, Any]], str | None]:
        headers = {"Authorization": self._authorization, "Accept": "application/json"}
        for attempt in range(MAX_RETRIES + 1):
            response = await client.get(
                f"{self.host}/api/public/v2/observations", params=params, headers=headers
            )
            if response.status_code == 429 and attempt < MAX_RETRIES:
                await self.sleep(_retry_wait(response))
                continue
            if not 200 <= response.status_code < 300:
                raise _status_error(response.status_code)
            break
        try:
            body = response.json()
        except ValueError:
            raise TraceFetchError("Langfuse returned a response that is not JSON") from None
        if not isinstance(body, dict):
            raise TraceFetchError("Langfuse returned an unexpected response shape")
        data = body.get("data")
        rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
        meta = body.get("meta")
        cursor = meta.get("cursor") if isinstance(meta, dict) else None
        return rows, cursor if isinstance(cursor, str) and cursor else None


def sort_observations(observations: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Oldest first; observations without a readable start time go last (stable)."""
    far = datetime.max.replace(tzinfo=UTC)
    return sorted(observations, key=lambda row: _parse_time(row.get("startTime")) or far)


# --- Digest ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class DigestStats:
    trace_count: int = 0
    observation_count: int = 0
    error_count: int = 0
    warning_count: int = 0
    generation_count: int = 0
    tool_count: int = 0
    models: list[str] = field(default_factory=list)
    total_tokens: int = 0
    generation_latency_p50_ms: int | None = None
    generation_latency_max_ms: int | None = None


@dataclass(frozen=True)
class TraceDigest:
    traces: list[dict[str, Any]]
    stats: DigestStats
    truncated: bool = False
    omitted_observations: int = 0

    def to_prompt_dict(self) -> dict[str, Any]:
        """A JSON-serializable view for the judge prompt (camelCase, no empty fields)."""
        result: dict[str, Any] = {
            "stats": {_camel(key): value for key, value in asdict(self.stats).items()},
            "traces": self.traces,
        }
        if self.truncated:
            result["truncated"] = (
                f"Digest truncated to fit {BUDGET_CHARS} characters: some inputs/outputs were"
                f" dropped and {self.omitted_observations} observation(s) were omitted."
            )
        return result


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.capitalize() for part in rest)


def _ms(seconds: float) -> int:
    return round(seconds * 1000)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _clip(value: Any, limit: int) -> str | None:
    if value is None or value == "" or value == {} or value == []:
        return None
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}…[+{len(text) - limit} chars]"


def _is_tool(observation: dict[str, Any]) -> bool:
    if str(observation.get("type") or "").upper() == "TOOL":
        return True
    name = str(observation.get("name") or "").lower()
    if "tool" in name or "function" in name:
        return True
    payload = observation.get("input")
    return isinstance(payload, dict) and bool(
        {"tool_calls", "tool_call_id", "arguments", "function"} & payload.keys()
    )


def _usage(observation: dict[str, Any]) -> dict[str, int] | None:
    details = observation.get("usageDetails") or observation.get("usage")
    if not isinstance(details, dict):
        return None
    numbers = {key: int(n) for key, value in details.items() if (n := _number(value)) is not None}
    if not numbers:
        return None
    usage = {key: numbers[key] for key in ("input", "output") if key in numbers}
    if "total" in numbers:
        usage["total"] = numbers["total"]
    elif usage:
        usage["total"] = sum(usage.values())
    else:
        usage["total"] = sum(numbers.values())
    return usage


def _duration_ms(observation: dict[str, Any]) -> int | None:
    begin = _parse_time(observation.get("startTime"))
    finish = _parse_time(observation.get("endTime"))
    if begin is not None and finish is not None:
        return max(0, _ms((finish - begin).total_seconds()))
    latency = _number(observation.get("latency"))  # seconds
    return None if latency is None else _ms(latency)


def _ttft_ms(observation: dict[str, Any]) -> int | None:
    begin = _parse_time(observation.get("startTime"))
    first = _parse_time(observation.get("completionStartTime"))
    if begin is not None and first is not None:
        return max(0, _ms((first - begin).total_seconds()))
    ttft = _number(observation.get("timeToFirstToken"))  # seconds
    return None if ttft is None else _ms(ttft)


def _offset_ms(moment: datetime | None, origin: datetime | None) -> int | None:
    if moment is None or origin is None:
        return None
    return _ms((moment - origin).total_seconds())


def _compact(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


def _entry(observation: dict[str, Any], origin: datetime | None, *, with_io: bool) -> dict:
    kind = str(observation.get("type") or "UNKNOWN").upper()
    level = str(observation.get("level") or "DEFAULT").upper()
    entry = _compact(
        {
            "type": kind,
            "name": observation.get("name"),
            "offsetMs": _offset_ms(_parse_time(observation.get("startTime")), origin),
            "durationMs": _duration_ms(observation),
            "model": observation.get("model") or None,
            "ttftMs": _ttft_ms(observation),
            "usage": _usage(observation),
        }
    )
    if level in ("WARNING", "ERROR"):
        entry["level"] = level
        if message := _clip(observation.get("statusMessage"), IO_CHARS):
            entry["statusMessage"] = message
    if with_io:
        limit = IO_CHARS if _is_tool(observation) or kind != "GENERATION" else GENERATION_IO_CHARS
        for key in ("input", "output"):
            if (text := _clip(observation.get(key), limit)) is not None:
                entry[key] = text
    return entry


def _size(value: Any) -> int:
    return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str))


def _stats(observations: list[dict[str, Any]], trace_count: int) -> DigestStats:
    levels = [str(row.get("level") or "").upper() for row in observations]
    generations = [
        row for row in observations if str(row.get("type") or "").upper() == "GENERATION"
    ]
    latencies = sorted(d for row in generations if (d := _duration_ms(row)) is not None)
    models = list(dict.fromkeys(str(row["model"]) for row in observations if row.get("model")))
    tokens = sum((usage or {}).get("total", 0) for usage in map(_usage, observations))
    return DigestStats(
        trace_count=trace_count,
        observation_count=len(observations),
        error_count=levels.count("ERROR"),
        warning_count=levels.count("WARNING"),
        generation_count=len(generations),
        tool_count=sum(1 for row in observations if _is_tool(row)),
        models=models,
        total_tokens=tokens,
        generation_latency_p50_ms=round(statistics.median(latencies)) if latencies else None,
        generation_latency_max_ms=latencies[-1] if latencies else None,
    )


def digest_observations(
    observations: Iterable[dict[str, Any]],
    *,
    origin: datetime | None,
    budget_chars: int = BUDGET_CHARS,
) -> TraceDigest:
    """Group observations by trace, chronologically, within `budget_chars`.

    Offsets are milliseconds from `origin` (the run start); without it, from the earliest
    observation. Past the budget, observations lose their input/output first, then are omitted;
    stats always cover every observation.
    """
    rows = sort_observations(row for row in observations if isinstance(row, dict))
    if origin is not None and origin.tzinfo is None:
        origin = origin.replace(tzinfo=UTC)
    starts = [moment for row in rows if (moment := _parse_time(row.get("startTime")))]
    if origin is None and starts:
        origin = starts[0]

    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(str(row.get("traceId") or "unknown"), []).append(row)

    used = 0
    truncated = False
    omitted = 0
    traces: list[dict[str, Any]] = []
    for trace_id, members in groups.items():  # insertion order: by first observation
        begins = [m for row in members if (m := _parse_time(row.get("startTime")))]
        ends = [m for row in members if (m := _parse_time(row.get("endTime")))]
        first = begins[0] if begins else None
        last = max([*begins, *ends]) if begins else None
        root = next((row for row in members if not row.get("parentObservationId")), members[0])
        name = next((row["traceName"] for row in members if row.get("traceName")), None)
        trace = _compact(
            {
                "traceId": trace_id,
                "name": name or root.get("name"),
                "offsetMs": _offset_ms(first, origin),
                "durationMs": _ms((last - first).total_seconds()) if first and last else None,
            }
        )
        used += _size(trace)
        entries: list[dict[str, Any]] = []
        for row in members:
            entry = _entry(row, origin, with_io=True)
            cost = _size(entry)
            if used + cost > budget_chars:
                truncated = True
                entry = _entry(row, origin, with_io=False)
                cost = _size(entry)
                if used + cost > budget_chars:
                    omitted += 1
                    continue
            used += cost
            entries.append(entry)
        trace["observations"] = entries
        traces.append(trace)

    return TraceDigest(
        traces=traces,
        stats=_stats(rows, len(groups)),
        truncated=truncated,
        omitted_observations=omitted,
    )
