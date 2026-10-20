"""Runs a flow: resolves its inputs, sends each step's request and reads the response.

Steps run in order and the run stops at the first step that fails (a request error, a value it
cannot save, or a failed check); later steps are reported as skipped. Every request is sent with
the real secret values, and recorded with `{{secret.<name>}}` in their place, so a record never
holds a secret: whoever reads it fills them in again only on purpose (see `curl`).
"""

import asyncio
import json
import math
import shlex
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from voice_eval.modules.apiflows.domain import (
    PLACEHOLDER,
    DurationCheck,
    FlowInput,
    Header,
    InputType,
    Operator,
    PathCheck,
    StatusCheck,
    Step,
)
from voice_eval.platform.egress import DestinationNotAllowed

STEP_TIMEOUT_S = 30.0
MAX_RECORDED_BODY_CHARS = 64_000
MAX_RESPONSE_BYTES = 5_000_000
USER_AGENT = "voice-eval-api-flows/1"

# names (with descriptions) → values; raises `GenerationError` when it cannot write them.
Generator = Callable[[list[FlowInput]], Awaitable[dict[str, str]]]


class FlowInputError(ValueError):
    """The run's inputs are unusable. `errors` are `{type, loc, msg}` items."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        super().__init__("invalid flow inputs")
        self.errors = errors


class GenerationError(Exception):
    """AI could not write the inputs it was asked for (message safe to show)."""


@dataclass
class ResolvedInput:
    name: str
    value: Any
    source: str  # "given", "default" or "generated"


@dataclass
class StepRecord:
    index: int
    title: str
    status: str  # "passed", "failed" or "skipped"
    request: dict[str, Any] | None = None
    response: dict[str, Any] | None = None
    duration_ms: int | None = None
    saved: dict[str, Any] = field(default_factory=dict)
    checks: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None


@dataclass
class RunOutcome:
    status: str  # "passed" or "failed"
    inputs: list[ResolvedInput]
    steps: list[StepRecord]
    duration_ms: int


# ---- inputs ----


def _typed(item: FlowInput, raw: Any, loc: list[Any]) -> Any:
    """The input's value in its type; FlowInputError when it does not fit."""
    if item.type is InputType.NUMBER:
        if isinstance(raw, bool):
            raise FlowInputError([_err(loc, "must be a number")])
        if isinstance(raw, int) or (isinstance(raw, float) and math.isfinite(raw)):
            return raw
        try:
            number = float(str(raw).strip())
        except (ValueError, OverflowError):
            raise FlowInputError([_err(loc, "must be a number")]) from None
        if not math.isfinite(number):
            raise FlowInputError([_err(loc, "must be a finite number")])
        return int(number) if number.is_integer() and "." not in str(raw) else number
    if item.type is InputType.BOOLEAN:
        if isinstance(raw, bool):
            return raw
        text = str(raw).strip().lower()
        if text in ("true", "false"):
            return text == "true"
        raise FlowInputError([_err(loc, "must be true or false")])
    if isinstance(raw, dict | list):
        raise FlowInputError([_err(loc, "must be text")])
    return str(raw)


def _err(loc: list[Any], msg: str) -> dict[str, Any]:
    return {"type": "value_error", "loc": loc, "msg": msg}


async def resolve_inputs(
    declared: list[FlowInput], given: Mapping[str, Any], generate: Generator | None
) -> list[ResolvedInput]:
    """Given values first, then defaults, then AI for inputs that describe how to write one."""
    known = {item.name for item in declared}
    errors = [
        _err(["inputs", name], "the flow has no such input") for name in given if name not in known
    ]
    resolved: dict[str, ResolvedInput] = {}
    to_generate: list[FlowInput] = []
    for item in declared:
        loc = ["inputs", item.name]
        try:
            if item.name in given and given[item.name] not in (None, ""):
                resolved[item.name] = ResolvedInput(
                    item.name, _typed(item, given[item.name], loc), "given"
                )
            elif item.default not in (None, ""):
                resolved[item.name] = ResolvedInput(
                    item.name, _typed(item, item.default, loc), "default"
                )
            elif item.generate:
                to_generate.append(item)
            else:
                errors.append(_err(loc, "a value is required (no default, nothing to generate)"))
        except FlowInputError as exc:
            errors += exc.errors
    if errors:
        raise FlowInputError(errors)
    if to_generate:
        if generate is None:
            raise FlowInputError(
                [
                    _err(
                        ["inputs", item.name],
                        "a value is required: no chat connection can write it",
                    )
                    for item in to_generate
                ]
            )
        written = await generate(to_generate)
        for item in to_generate:
            loc = ["inputs", item.name]
            if item.name not in written:
                raise GenerationError(f"AI wrote no value for {item.name!r}")
            try:
                value = _typed(item, written[item.name], loc)
            except FlowInputError as exc:
                problem = exc.errors[0]["msg"]
                raise GenerationError(f"AI wrote an unusable {item.name!r} ({problem})") from None
            resolved[item.name] = ResolvedInput(item.name, value, "generated")
    return [resolved[item.name] for item in declared]


# ---- templates ----


def placeholder(source: str, name: str) -> str:
    return "{{" + f"{source}.{name}" + "}}"


class _Context:
    def __init__(
        self, inputs: dict[str, Any], secrets: dict[str, str], *, lenient: bool = False
    ) -> None:
        self.values = {"input": inputs, "secret": secrets, "saved": {}}
        # Previews keep a placeholder that has no value yet instead of failing.
        self.lenient = lenient

    def lookup(self, source: str, name: str, *, keep_secrets: bool) -> tuple[bool, Any]:
        """(found, value); with `keep_secrets` a secret stays its own placeholder."""
        if source == "secret" and keep_secrets:
            return True, placeholder("secret", name)
        table = self.values.get(source, {})
        if name not in table:
            return (True, placeholder(source, name)) if self.lenient else (False, None)
        return True, table[name]

    def text(self, template: str, *, keep_secrets: bool) -> str:
        def replace(match: Any) -> str:
            found, value = self.lookup(match.group(1), match.group(2), keep_secrets=keep_secrets)
            if not found:
                raise _MissingValue(f"{{{{{match.group(1)}.{match.group(2)}}}}} has no value")
            return value if isinstance(value, str) else json.dumps(value)

        return PLACEHOLDER.sub(replace, template)

    def body(self, value: Any, *, keep_secrets: bool) -> Any:
        if isinstance(value, str):
            whole = PLACEHOLDER.fullmatch(value.strip())
            if whole:
                found, typed = self.lookup(
                    whole.group(1), whole.group(2), keep_secrets=keep_secrets
                )
                if not found:
                    raise _MissingValue(f"{value.strip()} has no value")
                return typed
            return self.text(value, keep_secrets=keep_secrets)
        if isinstance(value, list):
            return [self.body(item, keep_secrets=keep_secrets) for item in value]
        if isinstance(value, dict):
            return {key: self.body(item, keep_secrets=keep_secrets) for key, item in value.items()}
        return value


class _MissingValue(Exception):
    pass


def _url(base_url: str, path: str, query: list[tuple[str, str]], *, keep: bool) -> str:
    """Placeholders may put any text in the path: it stays a path (no new query or fragment).
    With `keep`, `{{…}}` placeholders stay readable so `curl` can fill them in later."""
    braces = "{}" if keep else ""
    url = base_url.rstrip("/") + quote(path, safe="/:@!$&'()*+,;=-._~%" + braces)
    return url + ("?" + urlencode(query, safe=braces) if query else "")


def _request(
    step: Step, base_url: str, headers: list[Header], ctx: _Context, *, keep: bool
) -> dict[str, Any]:
    query = [(param.name, ctx.text(param.value, keep_secrets=keep)) for param in step.query]
    all_headers = [
        (h.name, ctx.text(h.value, keep_secrets=keep)) for h in [*headers, *step.headers]
    ]
    body = None if step.body is None else ctx.body(step.body, keep_secrets=keep)
    if body is not None and not any(name.lower() == "content-type" for name, _ in all_headers):
        all_headers.append(("Content-Type", "application/json"))
    return {
        "method": step.method.value,
        "url": _url(base_url, ctx.text(step.path, keep_secrets=keep), query, keep=keep),
        "headers": [{"name": name, "value": value} for name, value in all_headers],
        "body": body,
    }


# ---- responses ----


def _read_path(response: dict[str, Any], path: str) -> tuple[bool, Any]:
    """(found, value) of `status`, `headers.<name>` or `body.a.0.b`; `.length` measures."""
    parts = path.split(".")
    if parts[0] == "status":
        return True, response["status"]
    if parts[0] == "headers":
        wanted = parts[1].lower()
        for header in response["headers"]:
            if header["name"].lower() == wanted:
                return True, header["value"]
        return False, None
    current: Any = response["body"]
    for i, part in enumerate(parts[1:], start=1):
        if part == "length" and i == len(parts) - 1 and isinstance(current, list | str | dict):
            return True, len(current)
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            return False, None
    return True, current


def _compare(op: Operator, actual: Any, expected: Any) -> bool:
    if op is Operator.EQ:
        return actual == expected or (not isinstance(actual, str) and str(actual) == str(expected))
    if op is Operator.NE:
        return not _compare(Operator.EQ, actual, expected)
    try:
        left, right = float(actual), float(expected)
    except (TypeError, ValueError):
        return False
    return {
        Operator.GT: left > right,
        Operator.GE: left >= right,
        Operator.LT: left < right,
        Operator.LE: left <= right,
    }[op]


def _check(check: Any, response: dict[str, Any], duration_ms: int) -> dict[str, Any]:
    if isinstance(check, StatusCheck):
        actual: Any = response["status"]
        passed = actual == check.equals
    elif isinstance(check, DurationCheck):
        actual = duration_ms
        passed = duration_ms <= check.max_ms
    else:
        assert isinstance(check, PathCheck)
        found, actual = _read_path(response, check.path)
        passed = (
            found
            if check.op is Operator.EXISTS
            else found and _compare(check.op, actual, check.value)
        )
    return {
        "check": check.model_dump(mode="json", by_alias=True),
        "passed": passed,
        "actual": _short(actual),
    }


def _short(value: Any) -> Any:
    """Values echoed into records stay small."""
    text = value if isinstance(value, str) else json.dumps(value)
    if len(text) <= 500:
        return value
    return text[:500] + "…"


def _body_of(response: httpx.Response, content: bytes) -> Any:
    kind = response.headers.get("content-type", "")
    text = content.decode(response.encoding or "utf-8", errors="replace")
    if "json" in kind:
        try:
            # NaN and Infinity are not JSON that the database can store: keep such bodies as text.
            return _storable(json.loads(text, parse_constant=_no_constant))
        except ValueError:
            pass
    return _storable(text)


def _no_constant(name: str) -> Any:
    raise ValueError(name)


def needs_generation(declared: list[FlowInput], given: Mapping[str, Any]) -> bool:
    """Whether AI must write some input (it has `generate`, no value given and no default)."""
    return any(
        item.generate and given.get(item.name) in (None, "") and item.default in (None, "")
        for item in declared
    )


def _storable(value: Any) -> Any:
    """`value` without NUL characters, which the database refuses in text and JSON."""
    if isinstance(value, str):
        return value.replace("\x00", "\ufffd")
    if isinstance(value, list):
        return [_storable(item) for item in value]
    if isinstance(value, dict):
        return {_storable(key): _storable(item) for key, item in value.items()}
    return value


def _hide(value: Any, secrets: dict[str, str]) -> Any:
    """`value` with every secret value replaced by its placeholder (responses can echo them)."""
    if isinstance(value, str):
        for name, secret in sorted(secrets.items(), key=lambda item: -len(item[1])):
            if secret:
                value = value.replace(secret, placeholder("secret", name))
        return value
    if isinstance(value, list):
        return [_hide(item, secrets) for item in value]
    if isinstance(value, dict):
        return {key: _hide(item, secrets) for key, item in value.items()}
    return value


def _capped(body: Any) -> Any:
    text = body if isinstance(body, str) else json.dumps(body)
    if len(text) <= MAX_RECORDED_BODY_CHARS:
        return body
    return (
        text[:MAX_RECORDED_BODY_CHARS]
        + f"… [{len(text) - MAX_RECORDED_BODY_CHARS} more characters]"
    )


async def _send(client: httpx.AsyncClient, request: dict[str, Any]) -> tuple[httpx.Response, bytes]:
    body = request["body"]
    async with client.stream(
        request["method"],
        request["url"],
        headers=[(h["name"], h["value"]) for h in request["headers"]],
        content=None if body is None else json.dumps(body).encode(),
    ) as response:
        content = b""
        async for chunk in response.aiter_bytes():
            content += chunk
            if len(content) > MAX_RESPONSE_BYTES:
                break
        return response, content[:MAX_RESPONSE_BYTES]


async def run_flow(
    *,
    base_url: str,
    headers: list[Header],
    secrets: dict[str, str],
    steps: list[Step],
    inputs: list[ResolvedInput],
    client: httpx.AsyncClient,
) -> RunOutcome:
    ctx = _Context({item.name: item.value for item in inputs}, secrets)
    records: list[StepRecord] = []
    started = time.monotonic()
    failed = False
    for index, step in enumerate(steps):
        record = StepRecord(index=index, title=step.title, status="skipped")
        records.append(record)
        if failed:
            continue
        failed = True  # until the step passes
        try:
            sent = _request(step, base_url, headers, ctx, keep=False)
            # Saved values can be secrets an earlier response echoed: hide those too.
            record.request = _hide(_request(step, base_url, headers, ctx, keep=True), secrets)
        except _MissingValue as exc:
            record.status, record.error = "failed", str(exc)
            continue
        begun = time.monotonic()
        try:
            # The client's timeout bounds each read; this bounds the whole step.
            async with asyncio.timeout(STEP_TIMEOUT_S):
                response, content = await _send(client, sent)
        except (httpx.TimeoutException, TimeoutError):
            record.status, record.error = "failed", f"no response within {STEP_TIMEOUT_S:g} s"
            continue
        except (httpx.HTTPError, DestinationNotAllowed) as exc:
            record.status, record.error = "failed", _transport_error(exc)
            continue
        record.duration_ms = round((time.monotonic() - begun) * 1000)
        seen = {
            "status": response.status_code,
            "headers": _storable([{"name": k, "value": v} for k, v in response.headers.items()]),
            "body": _body_of(response, content),
        }
        record.response = {
            "status": seen["status"],
            "headers": _hide(seen["headers"], secrets),
            "body": _capped(_hide(seen["body"], secrets)),
            "sizeBytes": len(content),
        }
        missing = []
        for save in step.saves:
            found, value = _read_path(seen, save.path)
            if found:
                ctx.values["saved"][save.name] = value
                record.saved[save.name] = _short(_hide(value, secrets))
            else:
                missing.append(f"{save.name} ({save.path} not found)")
        record.checks = [
            {**result, "actual": _hide(result["actual"], secrets)}
            for result in (_check(check, seen, record.duration_ms) for check in step.checks)
        ]
        if missing:
            record.status, record.error = "failed", "could not save " + ", ".join(missing)
        elif not all(item["passed"] for item in record.checks):
            record.status = "failed"
        else:
            record.status = "passed"
            failed = False
    return RunOutcome(
        status="failed" if failed else "passed",
        inputs=inputs,
        steps=records,
        duration_ms=round((time.monotonic() - started) * 1000),
    )


def _transport_error(exc: Exception) -> str:
    """A safe message: the kind of failure, never the URL (it may carry secrets)."""
    cause: BaseException | None = exc
    while cause is not None:
        if isinstance(cause, DestinationNotAllowed):
            return "the destination is not allowed (private or local network)"
        cause = cause.__cause__ or cause.__context__
    if isinstance(exc, httpx.ConnectError):
        return "could not connect to the API"
    return f"request failed ({type(exc).__name__})"


# ---- cURL ----


def preview_requests(
    *, base_url: str, headers: list[Header], steps: list[Step], inputs: dict[str, Any]
) -> list[dict[str, Any]]:
    """Each step's request as far as it is known before a run: given inputs filled in, saved
    values and secrets left as placeholders."""
    ctx = _Context(inputs, {}, lenient=True)
    return [_request(step, base_url, headers, ctx, keep=True) for step in steps]


def curl(
    request: dict[str, Any], secrets: Mapping[str, str] | None, hints: Mapping[str, str]
) -> str:
    """A shell command for a recorded request: secrets filled in when `secrets` is given,
    otherwise shown as their masked hints."""

    def fill(value: Any, *, in_url: bool = False) -> Any:
        if isinstance(value, str):

            def replace(match: Any) -> str:
                if match.group(1) != "secret":
                    return match.group(0)
                name = match.group(2)
                if secrets is not None and name in secrets:
                    # In a URL the value is encoded as it was when the request was sent.
                    return quote(secrets[name], safe="") if in_url else secrets[name]
                return hints.get(name, "••••")

            return PLACEHOLDER.sub(replace, value)
        if isinstance(value, list):
            return [fill(item) for item in value]
        if isinstance(value, dict):
            return {key: fill(item) for key, item in value.items()}
        return value

    parts = ["curl", "-X", request["method"], shlex.quote(fill(request["url"], in_url=True))]
    lines = [" ".join(parts)]
    for header in request["headers"]:
        lines.append("-H " + shlex.quote(f"{header['name']}: {fill(header['value'])}"))
    if request.get("body") is not None:
        lines.append("--data-raw " + shlex.quote(json.dumps(fill(request["body"]))))
    return " \\\n  ".join(lines)
