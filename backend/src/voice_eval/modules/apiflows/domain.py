"""API flows: saved, reusable sequences of HTTP calls against an API, grouped by API.

An API has a base URL, plain default headers and named secrets (sealed at rest). A flow has typed
inputs and ordered steps. Every text in a step (path, query and header values, body string
leaves) is a template whose placeholders name where a value comes from:

- `{{input.<name>}}`: a flow input, given when the flow runs (an input with `generate` set is
  written by AI when no value and no default is given);
- `{{secret.<name>}}`: one of the API's secrets;
- `{{saved.<name>}}`: a value an earlier step saved from its response.

A body string that is exactly one placeholder takes the value's own JSON type (a number input
stays a number); anywhere else the value is inserted as text.
"""

import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

MAX_NAME_LENGTH = 160
MAX_DESCRIPTION_LENGTH = 4000
MAX_TAGS = 20
MAX_TAG_LENGTH = 40
MAX_SECRETS = 10
MAX_SECRET_LENGTH = 4096
MAX_HEADERS = 30
MAX_HEADER_VALUE_LENGTH = 4096
MAX_INPUTS = 20
MAX_STEPS = 20
MAX_PARAMS = 30
MAX_SAVES = 20
MAX_CHECKS = 20
MAX_PATH_LENGTH = 2048
MAX_TEXT_LENGTH = 2000
MAX_BODY_CHARS = 20000
HINT_MASK = "••••"
HINT_MIN_SECRET_LENGTH = 8

IDENTIFIER = r"^[A-Za-z_][A-Za-z0-9_]{0,39}$"
HEADER_NAME = r"^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$"
# A dot path into a step's response: `status`, `headers.<name>` or `body[.key|.index]*`.
RESPONSE_PATH = r"^(status|headers\.[A-Za-z0-9-]{1,100}|body(\.[A-Za-z0-9_$-]{1,100}){0,20})$"
PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_]+)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
# A check reads the response like a save, and may end in `.length`; status has its own check.
CHECK_PATH = r"^(headers\.[A-Za-z0-9-]{1,100}|body(\.[A-Za-z0-9_$-]{1,100}){0,21})$"
SOURCES = ("input", "secret", "saved")


def _text(max_length: int, *, min_length: int = 0, pattern: str | None = None) -> Any:
    return StringConstraints(
        strip_whitespace=True, min_length=min_length, max_length=max_length, pattern=pattern
    )


Identifier = Annotated[str, _text(40, min_length=1, pattern=IDENTIFIER)]
Name = Annotated[str, _text(MAX_NAME_LENGTH, min_length=1)]
Description = Annotated[str, _text(MAX_DESCRIPTION_LENGTH)]
Tag = Annotated[str, _text(MAX_TAG_LENGTH, min_length=1)]
Tags = Annotated[list[Tag], Field(max_length=MAX_TAGS)]
HeaderName = Annotated[str, _text(100, min_length=1, pattern=HEADER_NAME)]
Template = Annotated[str, StringConstraints(max_length=MAX_TEXT_LENGTH)]
ResponsePath = Annotated[str, _text(260, min_length=1, pattern=RESPONSE_PATH)]


class DomainModel(BaseModel):
    """camelCase on the wire, snake_case in Python and in the stored JSON."""

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid", hide_input_in_errors=True
    )


class Header(DomainModel):
    name: HeaderName
    value: Annotated[str, StringConstraints(max_length=MAX_HEADER_VALUE_LENGTH)]


class Param(DomainModel):
    name: Annotated[str, _text(100, min_length=1)]
    value: Template


class InputType(StrEnum):
    TEXT = "text"
    NUMBER = "number"
    BOOLEAN = "boolean"


class FlowInput(DomainModel):
    name: Identifier
    type: InputType = InputType.TEXT
    description: Annotated[str, _text(500)] = ""
    default: Annotated[str, StringConstraints(max_length=MAX_TEXT_LENGTH)] | None = None
    # When set and the run gives no value (and there is no default), AI writes one from this.
    generate: Annotated[str, _text(1000, min_length=1)] | None = None


class Method(StrEnum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"


class Save(DomainModel):
    name: Identifier
    path: ResponsePath


class Operator(StrEnum):
    EXISTS = "exists"
    EQ = "=="
    NE = "!="
    GT = ">"
    GE = ">="
    LT = "<"
    LE = "<="


class StatusCheck(DomainModel):
    type: Literal["status"]
    equals: Annotated[int, Field(ge=100, le=599)]


class PathCheck(DomainModel):
    """`path` may end in `.length` (items of a list, characters of a text)."""

    type: Literal["path"]
    path: Annotated[str, _text(270, min_length=1, pattern=CHECK_PATH)]
    op: Operator = Operator.EXISTS
    value: str | int | float | bool | None = None

    @model_validator(mode="after")
    def _value_needed(self) -> "PathCheck":
        if self.op != Operator.EXISTS and self.value is None:
            raise ValueError(f"a value is required for {self.op.value}")
        return self


class DurationCheck(DomainModel):
    type: Literal["duration"]
    max_ms: Annotated[int, Field(ge=1, le=120_000)]


Check = Annotated[StatusCheck | PathCheck | DurationCheck, Field(discriminator="type")]


class Step(DomainModel):
    title: Annotated[str, _text(120)] = ""
    method: Method
    path: Annotated[str, _text(MAX_PATH_LENGTH, min_length=1, pattern=r"^/")]
    query: Annotated[list[Param], Field(max_length=MAX_PARAMS)] = []
    headers: Annotated[list[Header], Field(max_length=MAX_HEADERS)] = []
    # Any JSON; its string leaves are templates. None: no body.
    body: Any = None
    saves: Annotated[list[Save], Field(max_length=MAX_SAVES)] = []
    checks: Annotated[list[Check], Field(max_length=MAX_CHECKS)] = []

    @field_validator("body")
    @classmethod
    def _json_body(cls, value: Any) -> Any:
        try:
            size = len(json.dumps(value))
        except (TypeError, ValueError):
            raise ValueError("body must be JSON") from None
        if size > MAX_BODY_CHARS:
            raise ValueError(f"body must be at most {MAX_BODY_CHARS} characters of JSON")
        return value


Inputs = Annotated[list[FlowInput], Field(max_length=MAX_INPUTS)]
Steps = Annotated[list[Step], Field(min_length=1, max_length=MAX_STEPS)]


def placeholders(text: str) -> list[tuple[str, str]]:
    """The `(source, name)` pairs a template refers to, in order."""
    return [(match.group(1), match.group(2)) for match in PLACEHOLDER.finditer(text)]


def template_texts(step: Step) -> list[tuple[list[str | int], str]]:
    """Every template of a step with its location (camelCase, relative to the step)."""
    found: list[tuple[list[str | int], str]] = [(["path"], step.path)]
    found += [(["query", i, "value"], param.value) for i, param in enumerate(step.query)]
    found += [(["headers", i, "value"], header.value) for i, header in enumerate(step.headers)]

    def walk(value: Any, loc: list[str | int]) -> None:
        if isinstance(value, str):
            found.append((loc, value))
        elif isinstance(value, list):
            for i, item in enumerate(value):
                walk(item, [*loc, i])
        elif isinstance(value, dict):
            for key, item in value.items():
                walk(item, [*loc, key])

    walk(step.body, ["body"])
    return found


def check_flow(
    inputs: list[FlowInput], steps: list[Step], secrets: set[str]
) -> list[dict[str, Any]]:
    """Reference errors as `{type, loc, msg}` items: duplicate names, unknown inputs or secrets,
    and saved values used before (or without) the step that saves them."""
    errors: list[dict[str, Any]] = []
    names = [item.name for item in inputs]
    for i, name in enumerate(names):
        if name in names[:i]:
            errors.append(_error(["inputs", i, "name"], f"input {name!r} is defined twice"))
    saved_by: dict[str, int] = {}
    for n, step in enumerate(steps):
        for j, save in enumerate(step.saves):
            if save.name in saved_by:
                errors.append(
                    _error(
                        ["steps", n, "saves", j, "name"],
                        f"{save.name!r} is already saved by step {saved_by[save.name] + 1}",
                    )
                )
            else:
                saved_by[save.name] = n
    for n, step in enumerate(steps):
        for loc, text in template_texts(step):
            for source, name in placeholders(text):
                msg = _reference_problem(source, name, n, set(names), secrets, saved_by)
                if msg:
                    errors.append(_error(["steps", n, *loc], msg))
    return errors


def _reference_problem(
    source: str, name: str, step: int, inputs: set[str], secrets: set[str], saved_by: dict[str, int]
) -> str:
    if source not in SOURCES:
        return f"unknown placeholder source {source!r}; use input, secret or saved"
    if source == "input" and name not in inputs:
        return f"unknown input {name!r}"
    if source == "secret" and name not in secrets:
        return f"the API has no secret named {name!r}"
    if source == "saved":
        if name not in saved_by:
            return f"no step saves {name!r}"
        if saved_by[name] >= step:
            return f"{name!r} is saved by step {saved_by[name] + 1}, which runs after this one"
    return ""


def _error(loc: list[str | int], msg: str) -> dict[str, Any]:
    return {"type": "value_error", "loc": loc, "msg": msg}


def secret_hint(value: str) -> str:
    """What the API shows of a secret: a mask and, for long enough values, the last 4 characters."""
    return HINT_MASK + (value[-4:] if len(value) >= HINT_MIN_SECRET_LENGTH else "")


@dataclass(frozen=True)
class AgentRef:
    id: uuid.UUID
    name: str


@dataclass(frozen=True)
class ApiSummary:
    id: uuid.UUID
    name: str


@dataclass(frozen=True)
class SecretInfo:
    name: str
    hint: str


@dataclass(frozen=True)
class Api:
    id: uuid.UUID
    name: str
    description: str
    tags: list[str]
    base_url: str
    headers: list[Header]
    secrets: list[SecretInfo]
    created_at: datetime
    updated_at: datetime
    flow_count: int = 0
    agents: list[AgentRef] = field(default_factory=list)


@dataclass(frozen=True)
class Flow:
    id: uuid.UUID
    api: ApiSummary
    name: str
    description: str
    inputs: list[FlowInput]
    steps: list[Step]
    agents: list[AgentRef]
    created_at: datetime
    updated_at: datetime


class ApiNotFound(Exception):
    pass


class ApiNameTaken(Exception):
    pass


class ApiNotEmpty(Exception):
    def __init__(self, flow_count: int) -> None:
        super().__init__(f"the API holds {flow_count} flow(s)")
        self.flow_count = flow_count


class FlowNotFound(Exception):
    pass


class FlowNameTaken(Exception):
    pass


class InvalidFlowInput(ValueError):
    """`errors` is a list of `{"type", "loc", "msg"}` items; never the submitted value."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        super().__init__("invalid input")
        self.errors = errors
