"""Langfuse trace reader: the agent's observations for one session, and a digest for the judge.

`LangfuseTraceReader` reads `GET /api/public/v2/observations` for one `sessionId` inside a time
window, following the response cursor, and returns the raw observations in chronological order.
That v2 API exists only from Langfuse 4.x (and on Langfuse Cloud, where the v1 read APIs are
deprecated); a self-hosted Langfuse 2.x/3.x answers it with 404. Then the reader falls back to
the v1 public API, remembered for the reader's later fetches: `GET /api/public/traces` lists the
session's traces page by page and `GET /api/public/traces/{id}` returns each trace with its
observations embedded. A trace detail that cannot be read is skipped and the result flagged
incomplete; successful details are cached on the reader, so repeated polls only read new or
updated traces. Requests go through the egress guard like connection tests do,
redirects are never followed, and errors raise `TraceFetchError` whose message names the
failure only, never a key or anything the provider sent back.

`digest_observations` turns raw observations into a bounded, LLM-friendly structure: traces in
chronological order with offsets relative to the run start, per-observation timings, models,
usage, errors and truncated input/output, plus aggregate stats. Every observation field is
treated as optional; unknown types and shapes are tolerated.
"""

import asyncio
import base64
import json
import logging
import math
import statistics
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import quote

import httpx

from voice_eval.platform.egress import DestinationNotAllowed, Resolver, guarded_transport, resolve

log = logging.getLogger(__name__)

TIMEOUT_S = 30.0
PAGE_LIMIT = 1000
MAX_PAGES = 50  # 50k observations: far beyond one call; only guards against a cursor loop
V1_PAGE_LIMIT = 100  # traces per page of the v1 listing
MAX_TRACES = 500  # v1: per-trace detail requests per fetch
MAX_RETRIES = 3  # per request, on HTTP 429
MAX_RETRY_WAIT_S = 30.0
DEFAULT_RETRY_WAIT_S = 2.0
FIELDS = "core,basic,time,io,metadata,model,usage,metrics,trace_context"

IO_CHARS = 1500  # tool calls, spans and events
GENERATION_IO_CHARS = 600  # generation prompts are long and repeat across turns
NAME_CHARS = 200  # trace and observation names, trace ids
BUDGET_CHARS = 120_000

Sleep = Callable[[float], Awaitable[None]]


class TraceFetchError(Exception):
    """Observations could not be read; the message is safe to show and to log."""


class _EndpointNotFound(TraceFetchError):
    """HTTP 404: on the v2 Observations API, the cue to fall back to the v1 API."""


class SessionObservations(list[dict[str, Any]]):
    """A session's observations, oldest first.

    `page_cap_reached` is set when some were not read: a page or trace cap stopped the reading,
    or (v1) some trace details failed. The name is kept for `DigestStats.fetch_incomplete`.
    """

    def __init__(self, rows: Iterable[dict[str, Any]] = (), *, page_cap_reached: bool = False):
        super().__init__(rows)
        self.page_cap_reached = page_cap_reached


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
            if not math.isfinite(wait) or wait < 0:  # "nan", "inf", "-5": not a usable wait
                wait = DEFAULT_RETRY_WAIT_S
        except ValueError:
            try:
                wait = (parsedate_to_datetime(header) - datetime.now(UTC)).total_seconds()
            except (TypeError, ValueError, OverflowError):
                wait = DEFAULT_RETRY_WAIT_S
    return min(max(wait, 0.0), MAX_RETRY_WAIT_S)  # a date in the past: retry right away


def _status_error(status: int) -> TraceFetchError:
    if status in (401, 403):
        return TraceFetchError(f"Langfuse authentication failed (HTTP {status})")
    if status == 404:
        return _EndpointNotFound(f"Langfuse endpoint not found (HTTP {status}); check the host")
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
        max_traces: int = MAX_TRACES,
    ) -> None:
        self.host = host.rstrip("/")
        self.public_key = public_key
        self.transport = transport
        self.allow_private = allow_private
        self.resolver = resolver
        self.timeout_s = timeout_s
        self.sleep = sleep
        self.max_pages = max_pages
        self.max_traces = max_traces
        self._use_v1 = False  # set once the v2 Observations API answered 404
        # v1 trace details by trace id, with the listing's `updatedAt` when they were read.
        # The judge polls the same session for minutes; re-reading every trace on each poll
        # would multiply requests. A cached trace is read again only when the listing reports a
        # different `updatedAt`; without one, a trace still being written could miss later
        # observations, which is negligible once the run has ended. Failures are never cached.
        self._v1_details: dict[str, tuple[Any, dict[str, Any]]] = {}
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
    ) -> SessionObservations:
        """Every observation of `session_id` in [start, end], oldest first.

        When a page or trace cap stopped the reading while Langfuse still offered more, or (v1)
        some trace details could not be read, the result is incomplete and says so with
        `page_cap_reached`. When every v1 trace detail fails, the fetch fails.
        """
        found: dict[str, dict[str, Any]] = {}
        anonymous: list[dict[str, Any]] = []

        def keep(observation: dict[str, Any]) -> None:
            key = observation.get("id")
            if isinstance(key, str) and key:
                found[key] = observation
            else:
                anonymous.append(observation)

        try:
            async with httpx.AsyncClient(
                transport=self._transport(),
                timeout=self.timeout_s,
                follow_redirects=False,
                trust_env=False,  # no proxy or .netrc from the environment
            ) as client:
                if not self._use_v1:
                    try:
                        page_cap_reached = await self._read_v2(client, session_id, start, end, keep)
                    except _EndpointNotFound:  # only ever from the first page (see `_read_v2`)
                        log.info("langfuse v2 observations API missing; using the v1 API")
                        self._use_v1 = True
                if self._use_v1:
                    page_cap_reached = await self._read_v1(client, session_id, start, end, keep)
        except TraceFetchError as exc:
            raise TraceFetchError(str(exc)) from None  # never leak the internal subclass
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
        return SessionObservations(
            sort_observations([*found.values(), *anonymous]), page_cap_reached=page_cap_reached
        )

    async def _read_v2(
        self,
        client: httpx.AsyncClient,
        session_id: str,
        start: datetime,
        end: datetime,
        keep: Callable[[dict[str, Any]], None],
    ) -> bool:
        """Langfuse 4.x / Cloud: the cursor-paged v2 Observations API. True at the page cap."""
        base_params = {
            "sessionId": session_id,
            "fromStartTime": _iso(start),
            "toStartTime": _iso(end),
            "fields": FIELDS,
            "limit": str(PAGE_LIMIT),
        }
        cursor: str | None = None
        seen_cursors: set[str] = set()
        for _ in range(self.max_pages):
            params = dict(base_params) if cursor is None else {**base_params, "cursor": cursor}
            try:
                body = await self._get(client, "/api/public/v2/observations", params)
            except _EndpointNotFound as exc:
                if cursor is None:  # the first request: the API itself is missing
                    raise
                raise TraceFetchError(str(exc)) from None  # v2 exists: a later 404 is an error
            for observation in _rows(body):
                keep(observation)
            meta = body.get("meta")
            cursor = meta.get("cursor") if isinstance(meta, dict) else None
            if not isinstance(cursor, str) or not cursor or cursor in seen_cursors:
                return False
            seen_cursors.add(cursor)
        log.warning("langfuse pagination stopped after %d pages", self.max_pages)
        return True

    async def _read_v1(
        self,
        client: httpx.AsyncClient,
        session_id: str,
        start: datetime,
        end: datetime,
        keep: Callable[[dict[str, Any]], None],
    ) -> bool:
        """Langfuse 2.x/3.x: list the session's traces, then read each one's observations.

        True when the page or trace cap left traces unread, or some trace details failed.
        A failed detail is skipped; when every detail fails, its error is raised.
        """
        base_params = {
            "sessionId": session_id,
            "fromTimestamp": _iso(start),
            "toTimestamp": _iso(end),
            "limit": str(V1_PAGE_LIMIT),
        }
        trace_ids: dict[str, None] = {}  # insertion-ordered, deduplicated
        names: dict[str, str] = {}  # trace id -> trace name, for observations' `traceName`
        versions: dict[str, Any] = {}  # trace id -> the listing's `updatedAt`, if any
        capped = True
        for page in range(1, self.max_pages + 1):
            body = await self._get(client, "/api/public/traces", {**base_params, "page": str(page)})
            for trace in _rows(body):
                trace_id = trace.get("id")
                if not isinstance(trace_id, str) or not trace_id:
                    continue
                trace_ids.setdefault(trace_id)
                versions[trace_id] = trace.get("updatedAt")
                if isinstance(name := trace.get("name"), str) and name:
                    names[trace_id] = name
            meta = body.get("meta")
            total = _number(meta.get("totalPages")) if isinstance(meta, dict) else None
            if total is None or page >= total:
                capped = False
                break
        if capped:
            log.warning("langfuse trace listing stopped after %d pages", self.max_pages)
        if len(trace_ids) > self.max_traces:
            log.warning("langfuse trace details limited to %d traces", self.max_traces)
            trace_ids = dict.fromkeys(list(trace_ids)[: self.max_traces])
            capped = True
        failure: Exception | None = None
        read = 0
        for trace_id in trace_ids:
            cached = self._v1_details.get(trace_id)
            if cached is not None and cached[0] == versions.get(trace_id):
                trace = cached[1]
            else:
                path = f"/api/public/traces/{quote(trace_id, safe='')}"
                try:
                    trace = await self._get(client, path, {})
                except (TraceFetchError, httpx.HTTPError) as exc:
                    log.warning("langfuse trace detail skipped (%s)", type(exc).__name__)
                    failure = exc
                    continue
                self._v1_details[trace_id] = (versions.get(trace_id), trace)
            read += 1
            if isinstance(name := trace.get("name"), str) and name:
                names[trace_id] = name
            observations = trace.get("observations")
            if not isinstance(observations, list):
                continue
            for observation in observations:
                if not isinstance(observation, dict):
                    continue
                owner = observation.get("traceId")
                name = names.get(owner if isinstance(owner, str) else "") or names.get(trace_id)
                if not observation.get("traceName") and name:
                    observation = {**observation, "traceName": name}
                keep(observation)
        if failure is not None:
            if not read:  # nothing readable at all: fail with the (safe) last error
                raise failure
            capped = True
        return capped

    async def _get(
        self, client: httpx.AsyncClient, path: str, params: dict[str, str]
    ) -> dict[str, Any]:
        """One JSON object from `path`, retrying HTTP 429 a bounded number of times."""
        headers = {"Authorization": self._authorization, "Accept": "application/json"}
        for attempt in range(MAX_RETRIES + 1):
            response = await client.get(f"{self.host}{path}", params=params, headers=headers)
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
        return body


def _rows(body: dict[str, Any]) -> list[dict[str, Any]]:
    data = body.get("data")
    return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []


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
    fetch_incomplete: bool = False  # the reader stopped at its page cap: not every observation


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
            result["truncated"] = _truncation_note(self.omitted_observations)
        return result


def _truncation_note(omitted: int) -> str:
    return (
        "Digest truncated to fit the size budget: some inputs/outputs were dropped and"
        f" {omitted} observation(s) were omitted."
    )


# Reserved inside the budget so the note itself always fits (any realistic omitted count).
NOTE_RESERVE = len(_truncation_note(10**12))


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.capitalize() for part in rest)


def _ms(seconds: float) -> int:
    return round(seconds * 1000)


def _number(value: Any) -> float | None:
    """A finite number; NaN and infinities (invalid JSON) count as missing."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _seconds_ms(value: Any) -> int | None:
    """Milliseconds from a reported number of seconds; None when missing or absurd."""
    seconds = _number(value)
    if seconds is None or not math.isfinite(seconds * 1000):
        return None
    return _ms(seconds)


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
    return _seconds_ms(observation.get("latency"))


def _ttft_ms(observation: dict[str, Any]) -> int | None:
    begin = _parse_time(observation.get("startTime"))
    first = _parse_time(observation.get("completionStartTime"))
    if begin is not None and first is not None:
        return max(0, _ms((first - begin).total_seconds()))
    return _seconds_ms(observation.get("timeToFirstToken"))


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
            "name": _clip(observation.get("name"), NAME_CHARS),
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
    observation. `budget_chars` bounds the serialized traces plus the truncation note. Past
    the budget, observations lose their input/output first, then are omitted, and a trace with
    no observation left is dropped (its observations count as omitted); stats always cover
    every observation. An incomplete fetch (`SessionObservations.page_cap_reached`) is flagged
    in the stats.
    """
    fetch_incomplete = bool(getattr(observations, "page_cap_reached", False))
    rows = sort_observations(row for row in observations if isinstance(row, dict))
    if origin is not None and origin.tzinfo is None:
        origin = origin.replace(tzinfo=UTC)
    starts = [moment for row in rows if (moment := _parse_time(row.get("startTime")))]
    if origin is None and starts:
        origin = starts[0]

    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(str(row.get("traceId") or "unknown"), []).append(row)

    budget = max(0, budget_chars - NOTE_RESERVE)
    used = 2  # the list's brackets
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
                "traceId": _clip(trace_id, NAME_CHARS),
                "name": _clip(name or root.get("name"), NAME_CHARS),
                "offsetMs": _offset_ms(first, origin),
                "durationMs": _ms((last - first).total_seconds()) if first and last else None,
                "observations": [],
            }
        )
        header = _size(trace) + 1  # + the separating comma
        if used + header > budget:
            truncated = True
            omitted += len(members)
            continue
        used += header
        entries: list[dict[str, Any]] = trace["observations"]
        for row in members:
            entry = _entry(row, origin, with_io=True)
            cost = _size(entry) + 1
            if used + cost > budget:
                truncated = True
                entry = _entry(row, origin, with_io=False)
                cost = _size(entry) + 1
                if used + cost > budget:
                    omitted += 1
                    continue
            used += cost
            entries.append(entry)
        if not entries:  # nothing of it fits: drop the header too
            used -= header
            continue
        traces.append(trace)

    return TraceDigest(
        traces=traces,
        stats=replace(_stats(rows, len(groups)), fetch_incomplete=fetch_incomplete),
        truncated=truncated,
        omitted_observations=omitted,
    )
