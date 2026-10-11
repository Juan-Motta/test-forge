"""Langfuse trace reader (mocked HTTP, never the network) and the trace digest."""

import base64
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from voice_eval.providers.langfuse_traces import (
    LangfuseTraceReader,
    TraceFetchError,
    digest_observations,
)

HOST = "https://cloud.langfuse.com"
PUBLIC = "pk-lf-public"
SECRET = "sk-lf-very-secret-value"
START = datetime(2026, 10, 1, 12, 0, 0, tzinfo=UTC)
END = START + timedelta(minutes=10)


def at(ms: int) -> str:
    return (START + timedelta(milliseconds=ms)).isoformat().replace("+00:00", "Z")


def reader(handler, **kwargs) -> LangfuseTraceReader:
    return LangfuseTraceReader(
        HOST, PUBLIC, SECRET, transport=httpx.MockTransport(handler), **kwargs
    )


class FakeSleep:
    def __init__(self) -> None:
        self.waits: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.waits.append(seconds)


async def test_follows_the_cursor_and_returns_chronological_observations():
    requests: list[httpx.Request] = []
    pages = {
        None: {
            "data": [{"id": "c", "startTime": at(3000)}, {"id": "b", "startTime": at(2000)}],
            "meta": {"cursor": "page-2"},
        },
        "page-2": {"data": [{"id": "a", "startTime": at(1000)}], "meta": {}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=pages[request.url.params.get("cursor")])

    rows = await reader(handler).fetch_session("thread-1", start=START, end=END)

    assert [row["id"] for row in rows] == ["a", "b", "c"]
    assert len(requests) == 2
    first = requests[0]
    assert first.url.path == "/api/public/v2/observations"
    assert first.url.params["sessionId"] == "thread-1"
    assert first.url.params["fromStartTime"] == "2026-10-01T12:00:00Z"
    assert first.url.params["toStartTime"] == "2026-10-01T12:10:00Z"
    assert first.url.params["limit"] == "1000"
    assert "io" in first.url.params["fields"].split(",")
    assert "cursor" not in first.url.params
    assert requests[1].url.params["cursor"] == "page-2"
    expected = base64.b64encode(f"{PUBLIC}:{SECRET}".encode()).decode()
    assert first.headers["Authorization"] == f"Basic {expected}"


async def test_a_repeated_cursor_or_page_cap_stops_pagination():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"data": [], "meta": {"cursor": "same"}})

    assert await reader(handler).fetch_session("s", start=START, end=END) == []
    assert calls == 2  # the second answer repeats the cursor

    calls = 0

    def endless(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"data": [], "meta": {"cursor": f"c{calls}"}})

    assert await reader(endless, max_pages=3).fetch_session("s", start=START, end=END) == []
    assert calls == 3


async def test_rate_limits_honor_retry_after_then_succeed():
    sleep = FakeSleep()
    answers = iter(
        [
            httpx.Response(429, headers={"Retry-After": "4"}),
            httpx.Response(429, headers={"Retry-After": "600"}),
            httpx.Response(200, json={"data": [{"id": "x", "startTime": at(0)}]}),
        ]
    )
    rows = await reader(lambda request: next(answers), sleep=sleep).fetch_session(
        "s", start=START, end=END
    )
    assert [row["id"] for row in rows] == ["x"]
    assert sleep.waits == [4.0, 30.0]  # capped


async def test_rate_limit_gives_up_after_bounded_retries():
    sleep = FakeSleep()
    with pytest.raises(TraceFetchError, match="rate limit"):
        await reader(lambda request: httpx.Response(429), sleep=sleep).fetch_session(
            "s", start=START, end=END
        )
    assert len(sleep.waits) == 3


@pytest.mark.parametrize(
    ("status", "message"),
    [(401, "authentication failed"), (404, "not found"), (500, "server error"), (302, "redirect")],
)
async def test_errors_name_the_status_but_never_the_keys(status, message):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text=f"echo {SECRET}", headers={"Location": HOST})

    with pytest.raises(TraceFetchError, match=message) as caught:
        await reader(handler).fetch_session("s", start=START, end=END)
    text = str(caught.value)
    assert SECRET not in text and PUBLIC not in text
    assert caught.value.__cause__ is None


async def test_a_body_that_is_not_json_is_a_fetch_error():
    with pytest.raises(TraceFetchError, match="not JSON"):
        await reader(lambda request: httpx.Response(200, text="<html>")).fetch_session(
            "s", start=START, end=END
        )


async def test_network_errors_are_fetch_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(TraceFetchError, match="Could not connect"):
        await reader(handler).fetch_session("s", start=START, end=END)


async def test_the_egress_guard_blocks_private_destinations():
    async def loopback(host: str, port: int) -> list[str]:
        return ["127.0.0.1"]

    guarded = LangfuseTraceReader(HOST, PUBLIC, SECRET, resolver=loopback)
    with pytest.raises(TraceFetchError, match="not allowed") as caught:
        await guarded.fetch_session("s", start=START, end=END)
    assert SECRET not in str(caught.value)
    assert SECRET not in repr(guarded)


# --- v1 fallback (Langfuse 2.x/3.x has no v2 Observations API) ------------------------------


def v1_server(traces: dict[str, dict], *, pages: list[list[str]], seen: list[httpx.Request]):
    """v2 answers 404; v1 lists `pages` of trace ids and serves each trace's detail."""

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        if path == "/api/public/v2/observations":
            return httpx.Response(404, json={"message": "Not found"})
        if path == "/api/public/traces":
            page = int(request.url.params.get("page", "1"))
            ids = pages[page - 1] if page <= len(pages) else []
            return httpx.Response(
                200,
                json={
                    "data": [{"id": i, "name": traces[i].get("name")} for i in ids],
                    "meta": {"page": page, "limit": 100, "totalPages": len(pages)},
                },
            )
        trace_id = path.rsplit("/", 1)[-1]
        return httpx.Response(200, json=traces[trace_id])

    return handler


V1_TRACES = {
    "t1": {
        "id": "t1",
        "name": "turn-one",
        "observations": [
            {"id": "b", "traceId": "t1", "startTime": at(2000)},
            {"id": "a", "traceId": "t1", "startTime": at(1000), "traceName": "kept"},
        ],
    },
    "t2": {
        "id": "t2",
        "name": "turn-two",
        "observations": [
            {"id": "c", "traceId": "t2", "startTime": at(3000)},
            {"id": "b", "traceId": "t1", "startTime": at(2000)},  # duplicate id
        ],
    },
    "t3": {"id": "t3", "name": "empty", "observations": []},
}


async def test_a_v2_404_falls_back_to_the_v1_traces_api():
    seen: list[httpx.Request] = []
    handler = v1_server(V1_TRACES, pages=[["t1", "t2"], ["t3"]], seen=seen)

    rows = await reader(handler).fetch_session("thread-1", start=START, end=END)

    assert [row["id"] for row in rows] == ["a", "b", "c"]
    assert [row["traceName"] for row in rows] == ["kept", "turn-one", "turn-two"]
    assert not rows.page_cap_reached
    listings = [r for r in seen if r.url.path == "/api/public/traces"]
    assert [r.url.params["page"] for r in listings] == ["1", "2"]
    first = listings[0]
    assert first.url.params["sessionId"] == "thread-1"
    assert first.url.params["fromTimestamp"] == "2026-10-01T12:00:00Z"
    assert first.url.params["toTimestamp"] == "2026-10-01T12:10:00Z"
    assert first.url.params["limit"] == "100"
    details = sorted(r.url.path for r in seen if r.url.path.startswith("/api/public/traces/"))
    assert details == ["/api/public/traces/t1", "/api/public/traces/t2", "/api/public/traces/t3"]
    expected = base64.b64encode(f"{PUBLIC}:{SECRET}".encode()).decode()
    assert all(r.headers["Authorization"] == f"Basic {expected}" for r in seen)


async def test_the_v1_fallback_is_remembered_for_later_fetches():
    seen: list[httpx.Request] = []
    trace_reader = reader(v1_server(V1_TRACES, pages=[["t1"]], seen=seen))

    await trace_reader.fetch_session("s", start=START, end=END)
    seen.clear()
    rows = await trace_reader.fetch_session("s", start=START, end=END)

    assert [row["id"] for row in rows] == ["a", "b"]
    assert all(r.url.path != "/api/public/v2/observations" for r in seen)


async def test_a_v1_404_too_is_the_safe_not_found_error():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(404, text=f"echo {SECRET}")

    with pytest.raises(TraceFetchError, match="not found") as caught:
        await reader(handler).fetch_session("s", start=START, end=END)
    assert SECRET not in str(caught.value)
    assert [r.url.path for r in seen] == ["/api/public/v2/observations", "/api/public/traces"]


async def test_a_rate_limited_v1_trace_detail_is_retried():
    sleep = FakeSleep()
    seen: list[httpx.Request] = []
    inner = v1_server(V1_TRACES, pages=[["t2"]], seen=seen)
    limited = {"left": 1}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/public/traces/t2" and limited["left"]:
            limited["left"] -= 1
            return httpx.Response(429, headers={"Retry-After": "3"})
        return inner(request)

    rows = await reader(handler, sleep=sleep).fetch_session("s", start=START, end=END)

    assert [row["id"] for row in rows] == ["b", "c"]
    assert sleep.waits == [3.0]


async def test_v1_caps_flag_an_incomplete_fetch():
    seen: list[httpx.Request] = []
    handler = v1_server(V1_TRACES, pages=[["t1"], ["t2"], ["t3"]], seen=seen)
    rows = await reader(handler, max_pages=2).fetch_session("s", start=START, end=END)
    assert rows.page_cap_reached
    assert [row["id"] for row in rows] == ["a", "b", "c"]

    seen.clear()
    handler = v1_server(V1_TRACES, pages=[["t1", "t2"]], seen=seen)
    rows = await reader(handler, max_traces=1).fetch_session("s", start=START, end=END)
    assert rows.page_cap_reached
    assert [row["id"] for row in rows] == ["a", "b"]


# --- Digest ---------------------------------------------------------------------------------


def observation(**fields):
    return {"type": "SPAN", "level": "DEFAULT", **fields}


SAMPLE = [
    observation(
        id="g1",
        traceId="t1",
        traceName="turn",
        type="GENERATION",
        name="llm",
        startTime=at(1500),
        endTime=at(2500),
        completionStartTime=at(1800),
        model="gpt-x",
        usageDetails={"input": 100, "output": 20, "total": 120},
        input=[{"role": "system", "content": "s" * 5000}],
        output="hello",
        parentObservationId="root1",
    ),
    observation(id="root1", traceId="t1", name="agent-turn", startTime=at(1000), endTime=at(3000)),
    observation(
        id="tool1",
        traceId="t1",
        type="TOOL",
        name="lookup_order",
        startTime=at(2600),
        endTime=at(2900),
        input={"order": "123", "pad": "p" * 3000},
        output={"status": "shipped"},
        parentObservationId="root1",
    ),
    observation(
        id="g2",
        traceId="t2",
        type="GENERATION",
        name="llm",
        startTime=at(5000),
        endTime=at(8000),
        model="gpt-y",
        usageDetails={"input": 50, "output": 10},
        level="ERROR",
        statusMessage="upstream timeout",
    ),
    observation(id="w", traceId="t2", name="guard", startTime=at(6000), level="WARNING"),
]


def test_digest_groups_by_trace_with_offsets_from_the_run_start():
    digest = digest_observations(SAMPLE, origin=START)

    assert [trace["traceId"] for trace in digest.traces] == ["t1", "t2"]
    first, second = digest.traces
    assert first["name"] == "turn"
    assert (first["offsetMs"], first["durationMs"]) == (1000, 2000)
    assert [entry["name"] for entry in first["observations"]] == [
        "agent-turn",
        "llm",
        "lookup_order",
    ]
    generation = first["observations"][1]
    assert generation["offsetMs"] == 1500
    assert generation["durationMs"] == 1000
    assert generation["ttftMs"] == 300
    assert generation["model"] == "gpt-x"
    assert generation["usage"] == {"input": 100, "output": 20, "total": 120}
    assert "level" not in generation
    assert second["name"] == "llm"  # no traceName: the root observation's name
    failing = second["observations"][0]
    assert (failing["level"], failing["statusMessage"]) == ("ERROR", "upstream timeout")
    assert failing["usage"]["total"] == 60


def test_digest_truncates_generation_io_harder_than_tool_io():
    entries = digest_observations(SAMPLE, origin=START).traces[0]["observations"]
    generation, tool = entries[1], entries[2]
    assert generation["input"].endswith("chars]") and len(generation["input"]) < 700
    assert tool["input"].startswith('{"order":"123"')
    assert 1500 < len(tool["input"]) < 1600
    assert tool["output"] == '{"status":"shipped"}'
    assert generation["output"] == "hello"


def test_digest_stats_cover_every_observation():
    stats = digest_observations(SAMPLE, origin=START).stats
    assert stats.trace_count == 2
    assert stats.observation_count == 5
    assert (stats.error_count, stats.warning_count) == (1, 1)
    assert (stats.generation_count, stats.tool_count) == (2, 1)
    assert stats.models == ["gpt-x", "gpt-y"]
    assert stats.total_tokens == 180
    assert stats.generation_latency_p50_ms == 2000
    assert stats.generation_latency_max_ms == 3000


def test_digest_respects_the_budget_and_marks_truncation():
    digest = digest_observations(SAMPLE, origin=START, budget_chars=700)
    assert digest.truncated
    assert digest.stats.observation_count == 5  # stats are never truncated
    kept = [entry for trace in digest.traces for entry in trace["observations"]]
    assert len(kept) + digest.omitted_observations == 5
    assert all("input" not in entry for entry in kept[1:])
    prompt = digest.to_prompt_dict()
    assert "truncated" in prompt
    assert len(json.dumps(prompt)) < 2000
    assert prompt["stats"]["generationLatencyP50Ms"] == 2000


def test_digest_tolerates_missing_and_odd_fields():
    digest = digest_observations(
        [{}, {"type": "WEIRD", "startTime": "not-a-date", "usageDetails": "n/a", "latency": 1.2}],
        origin=None,
    )
    assert digest.stats.observation_count == 2
    assert digest.traces[0]["traceId"] == "unknown"
    weird = digest.traces[0]["observations"]
    assert {entry["type"] for entry in weird} == {"UNKNOWN", "WEIRD"}
    assert any(entry.get("durationMs") == 1200 for entry in weird)
    json.dumps(digest.to_prompt_dict())
    assert not digest.truncated


def test_digest_without_origin_measures_from_the_first_observation():
    digest = digest_observations(SAMPLE, origin=None)
    assert digest.traces[0]["offsetMs"] == 0
    assert digest.traces[1]["offsetMs"] == 4000


def _traces_and_note_size(digest) -> int:
    prompt = digest.to_prompt_dict()
    traces = len(json.dumps(prompt["traces"], separators=(",", ":"), ensure_ascii=False))
    return traces + len(prompt.get("truncated", ""))


def test_digest_counts_trace_headers_and_drops_traces_that_no_longer_fit():
    rows = [
        observation(
            id=f"o{index}",
            traceId=f"trace-{index}",
            traceName="n" * 5000,
            name="x" * 5000,
            startTime=at(index * 10),
        )
        for index in range(300)
    ]
    budget = 3000
    digest = digest_observations(rows, origin=START, budget_chars=budget)

    assert digest.truncated
    assert _traces_and_note_size(digest) <= budget
    assert all(trace["observations"] for trace in digest.traces)  # no empty traces
    assert all(len(trace["name"]) < 300 for trace in digest.traces)
    kept = sum(len(trace["observations"]) for trace in digest.traces)
    assert kept + digest.omitted_observations == 300
    assert digest.stats.trace_count == 300 and digest.stats.observation_count == 300


def test_digest_with_a_tiny_budget_still_fits_the_truncation_note():
    digest = digest_observations(SAMPLE, origin=START, budget_chars=250)
    assert digest.truncated
    assert _traces_and_note_size(digest) <= 250
    assert digest.omitted_observations + sum(len(t["observations"]) for t in digest.traces) == 5


def test_digest_ignores_non_finite_numbers():
    nan, inf = float("nan"), float("inf")
    rows = [
        observation(
            id="g",
            traceId="t",
            type="GENERATION",
            latency=nan,
            timeToFirstToken=inf,
            usageDetails={"input": nan, "output": inf, "total": -inf},
        ),
        observation(id="h", traceId="t", type="GENERATION", latency=inf, usage={"total": 5}),
        observation(id="i", traceId="t", type="GENERATION", latency=1e308),  # overflows in ms
    ]
    digest = digest_observations(rows, origin=START)
    text = json.dumps(digest.to_prompt_dict(), allow_nan=False)  # raises on NaN/Infinity
    assert "durationMs" not in text and "ttftMs" not in text
    assert digest.stats.total_tokens == 5
    assert digest.stats.generation_latency_max_ms is None


@pytest.mark.parametrize("value", ["nan", "-5", "inf", "-inf", "garbage"])
async def test_an_odd_retry_after_falls_back_to_the_default_wait(value):
    sleep = FakeSleep()
    answers = iter(
        [
            httpx.Response(429, headers={"Retry-After": value}),
            httpx.Response(200, json={"data": []}),
        ]
    )
    await reader(lambda request: next(answers), sleep=sleep).fetch_session(
        "s", start=START, end=END
    )
    assert sleep.waits == [2.0]


async def test_hitting_the_page_cap_is_reported_to_the_caller_and_the_digest():
    calls = 0

    def endless(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        row = {"id": f"o{calls}", "traceId": "t", "startTime": at(calls)}
        return httpx.Response(200, json={"data": [row], "meta": {"cursor": f"c{calls}"}})

    rows = await reader(endless, max_pages=3).fetch_session("s", start=START, end=END)
    assert len(rows) == 3
    assert rows.page_cap_reached is True

    def single(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [], "meta": {}})

    complete = await reader(single).fetch_session("s", start=START, end=END)
    assert complete.page_cap_reached is False

    digest = digest_observations(rows, origin=START)
    assert digest.stats.fetch_incomplete is True
    assert digest.to_prompt_dict()["stats"]["fetchIncomplete"] is True
    assert digest_observations(complete, origin=START).stats.fetch_incomplete is False
