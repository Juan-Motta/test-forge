"""Render the agent skill: frontmatter, the curated guide and an endpoint reference.

The guide (`guide.md`, packaged next to this module) is prose versioned with the code. The
endpoint reference is generated from the app's OpenAPI schema at request time, so it lists
exactly the operations the running app serves: hidden routes are not in the schema, `$ref`s
are resolved, enums are inlined, and object types used inside another schema are described once
in a closing "Schemas" section.
"""

import io
import json
import zipfile
from importlib import resources
from typing import Any

SKILL_NAME = "voice-evaluator"
# One line of plain YAML: no ": " or " #" in it, so no quoting is needed.
DESCRIPTION = (
    "Use this skill to evaluate a realtime voice agent with the voice-evaluator platform through "
    "its HTTP API. Set up provider connections, agents under test and scenarios, launch batches "
    "of simulated phone calls (runs), follow them live or by polling, then read the judge's "
    "results (overall score, per-criterion verdicts, failure tags, evidence) and the Markdown "
    "brief of what to fix in the agent. Use it whenever a task mentions voice-evaluator, "
    "voice-eval, evaluating or testing a voice agent with simulated callers, or reading run "
    "transcripts, latencies or judgements, and you hold a voice-evaluator API key."
)
HTTP_METHODS = ("get", "post", "put", "patch", "delete")
REF_PREFIX = "#/components/schemas/"
MAX_ENUM_VALUES = 12


def guide() -> str:
    return resources.files(__package__).joinpath("guide.md").read_text(encoding="utf-8")


def _number(value: Any) -> str:
    """`1.0` -> `1` (pydantic emits integral bounds as floats), anything else as is."""
    return str(int(value)) if isinstance(value, float) and value.is_integer() else str(value)


def _display(name: str) -> str:
    """A component name without FastAPI's module-path disambiguation (`a__b__CreateIn`)."""
    return name.rsplit("__", 1)[-1]


class _Reference:
    """One rendering pass over an OpenAPI document.

    Each object type is described once: inline at the first operation that returns it, or in
    the closing "Schemas" section when it only appears inside another type. Request bodies are
    always described inline, at their operation.
    """

    def __init__(self, spec: dict[str, Any]) -> None:
        self.spec = spec
        self.schemas: dict[str, Any] = spec.get("components", {}).get("schemas", {})
        self.pending: list[str] = []  # object types mentioned, for the "Schemas" section
        self.inline_at: dict[str, str] = {}  # object type -> the operation describing it

    # --- schemas --------------------------------------------------------------------------

    def resolve(self, schema: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
        """The schema's component name (if it is a `$ref`) and its resolved body."""
        ref = schema.get("$ref")
        if isinstance(ref, str) and ref.startswith(REF_PREFIX):
            name = ref.removeprefix(REF_PREFIX)
            return name, self.schemas.get(name, {})
        return None, schema

    def is_object(self, schema: dict[str, Any]) -> bool:
        return schema.get("type") == "object" and bool(schema.get("properties"))

    def mention(self, name: str) -> str:
        if name not in self.pending:
            self.pending.append(name)
        return _display(name)

    def type_of(self, schema: dict[str, Any]) -> str:
        """A compact type: `string (uuid)`, `array of Criterion`, `"a" | "b"`, `X | null`."""
        name, body = self.resolve(schema)
        if "enum" in body:
            values = [json.dumps(value) for value in body["enum"][:MAX_ENUM_VALUES]]
            more = " | …" if len(body["enum"]) > MAX_ENUM_VALUES else ""
            return " | ".join(values) + more
        if "const" in body:
            return json.dumps(body["const"])
        if name is not None and self.is_object(body):
            return self.mention(name)
        for key in ("anyOf", "oneOf"):
            if key in body:
                return " | ".join(dict.fromkeys(self.type_of(item) for item in body[key]))
        if "allOf" in body and len(body["allOf"]) == 1:
            return self.type_of(body["allOf"][0])
        kind = body.get("type")
        if kind == "array":
            return f"array of {self.type_of(body.get('items', {}))}"
        if kind == "object":
            extra = body.get("additionalProperties")
            if isinstance(extra, dict) and extra:
                return f"object of {self.type_of(extra)}"
            return "object"
        if kind is None:
            return "any"
        return f"{kind} ({body['format']})" if "format" in body else str(kind)

    def constraints(self, schema: dict[str, Any]) -> list[str]:
        _, body = self.resolve(schema)
        found: list[str] = []
        for item in [body, *body.get("anyOf", [])]:
            _, item = self.resolve(item)
            for low_key, high_key, unit in (
                ("minLength", "maxLength", " chars"),
                ("minimum", "maximum", ""),
                ("minItems", "maxItems", " items"),
            ):
                low, high = item.get(low_key), item.get(high_key)
                if high is not None:
                    found.append(f"{_number(low or 0)}-{_number(high)}{unit}")
                elif low is not None:
                    found.append(f">= {_number(low)}{unit}")
            if "pattern" in item:
                found.append(f"pattern `{item['pattern']}`")
        default = schema.get("default", body.get("default"))
        if default is not None and default not in ([], {}):
            found.append(f"default {json.dumps(default, ensure_ascii=False)}")
        return found

    def field_lines(self, body: dict[str, Any], indent: str = "") -> list[str]:
        required = set(body.get("required", []))
        lines = []
        for field, schema in body.get("properties", {}).items():
            parts = [self.type_of(schema), "required" if field in required else "optional"]
            parts += self.constraints(schema)
            lines.append(f"{indent}- `{field}`: " + ", ".join(parts))
        return lines

    def describe(self, schema: dict[str, Any], where: str | None) -> list[str]:
        """An object's fields (or an array's item fields), as a heading line plus field lines.

        With `where` (a response), a named type already described elsewhere is only referred
        to, and a new one is recorded as described there.
        """
        name, body = self.resolve(schema)
        prefix = ""
        if body.get("type") == "array":
            name, body = self.resolve(body.get("items", {}))
            prefix = "array of "
        if not self.is_object(body):
            return [f"`{self.type_of(schema)}`"]
        if name is None:
            return [f"{prefix}object:", *self.field_lines(body, "  ")]
        if where is not None:
            if name in self.inline_at:
                return [f"{prefix}`{_display(name)}` (fields under {self.inline_at[name]})"]
            self.inline_at[name] = where
            return [f"{prefix}`{_display(name)}`:", *self.field_lines(body, "  ")]
        return [f"{prefix}object:", *self.field_lines(body, "  ")]

    # --- operations -----------------------------------------------------------------------

    def parameters(self, operation: dict[str, Any]) -> list[str]:
        lines = []
        for parameter in operation.get("parameters", []):
            _, parameter = self.resolve(parameter)
            schema = parameter.get("schema", {})
            parts = [
                parameter.get("in", "?"),
                self.type_of(schema),
                "required" if parameter.get("required") else "optional",
                *self.constraints(schema),
            ]
            lines.append(f"- `{parameter.get('name')}`: " + ", ".join(parts))
        return ["Parameters:", *lines] if lines else []

    def request_body(self, operation: dict[str, Any]) -> list[str]:
        _, body = self.resolve(operation.get("requestBody", {}))
        content = body.get("content", {})
        if not content:
            return []
        media, entry = next(iter(content.items()))
        lines = self.describe(entry.get("schema", {}), None)
        return [f"Request body ({media}): {lines[0]}", *lines[1:]]

    def responses(self, operation: dict[str, Any], where: str) -> list[str]:
        lines = []
        for code, response in operation.get("responses", {}).items():
            if not str(code).startswith("2"):
                continue  # errors are documented in the guide
            _, response = self.resolve(response)
            content = response.get("content", {})
            if not content:
                lines.append(f"Response {code}: no body")
                continue
            media, entry = next(iter(content.items()))
            schema = entry.get("schema", {})
            if media != "application/json" or not schema:
                lines.append(f"Response {code}: {media}")
                continue
            described = self.describe(schema, where)
            lines += [f"Response {code} ({media}): {described[0]}", *described[1:]]
        return lines

    def operation(self, method: str, path: str, operation: dict[str, Any]) -> list[str]:
        where = f"`{method.upper()} {path}`"
        lines = [f"### {method.upper()} {path}", ""]
        summary = operation.get("summary")
        description = " ".join(operation.get("description", "").split())
        if summary:
            lines.append(summary if summary.endswith(".") else f"{summary}.")
        if description:
            lines.append(description)
        if summary or description:
            lines.append("")
        for block in (
            self.parameters(operation),
            self.request_body(operation),
            self.responses(operation, where),
        ):
            if block:
                lines += [*block, ""]
        return lines

    def appendix(self) -> list[str]:
        lines: list[str] = []
        done: set[str] = set()
        while self.pending:
            name = self.pending.pop(0)
            if name in done:
                continue
            done.add(name)
            lines += [f"### {_display(name)}", ""]
            if name in self.inline_at:
                lines += [f"Fields under {self.inline_at[name]}.", ""]
                continue
            body = self.schemas.get(name, {})
            if body.get("description"):
                lines += [" ".join(body["description"].split()), ""]
            lines += [*self.field_lines(body), ""]
        return lines

    def render(self) -> str:
        groups: dict[str, list[tuple[str, str, dict[str, Any]]]] = {}
        for path, item in self.spec.get("paths", {}).items():
            for method in HTTP_METHODS:
                operation = item.get(method)
                if operation is None:
                    continue
                tag = (operation.get("tags") or ["other"])[0]
                groups.setdefault(tag, []).append((method, path, operation))
        lines = [
            "## Endpoint reference",
            "",
            "Generated from the running app's OpenAPI schema. Every path is relative to the "
            "platform's origin; every request needs `Authorization: Bearer <API key>` except "
            "`GET /api/health` and `POST /api/auth/login`. JSON keys are camelCase. Error "
            "responses (401, 404, 409, 422) are described in the guide above. Each object type "
            'is described once; types used only inside others are in "Schemas" at the end. '
            "The WebSocket endpoints are not part of OpenAPI: see the live stream section of "
            "the guide.",
            "",
        ]
        for tag, operations in groups.items():
            lines += [f"## Endpoints: {tag}", ""]
            for method, path, operation in operations:
                lines += self.operation(method, path, operation)
        appendix = self.appendix()
        if appendix:
            lines += ["## Schemas", "", "Object types used inside the bodies above.", ""]
            lines += appendix
        return "\n".join(lines).rstrip() + "\n"


def render_reference(spec: dict[str, Any]) -> str:
    """The endpoint reference of an OpenAPI document, as Markdown."""
    return _Reference(spec).render()


def render_skill(spec: dict[str, Any], *, origin: str | None = None) -> str:
    """`SKILL.md`: frontmatter, the guide, then the reference generated from `spec`."""
    served = (
        f"\n> This skill was served by `{origin}`: use that origin as the base URL of every "
        "path below.\n"
        if origin
        else ""
    )
    return (
        f"---\nname: {SKILL_NAME}\ndescription: {DESCRIPTION}\n---\n\n"
        f"{guide().strip()}\n{served}\n{render_reference(spec)}"
    )


def skill_zip(spec: dict[str, Any], *, origin: str | None = None) -> bytes:
    """The skill folder (`voice-evaluator/SKILL.md` and `reference/openapi.json`) as a zip."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{SKILL_NAME}/SKILL.md", render_skill(spec, origin=origin))
        archive.writestr(
            f"{SKILL_NAME}/reference/openapi.json",
            json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
        )
    return buffer.getvalue()
