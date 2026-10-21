import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  checkRule,
  defaultStepIndex,
  jsonTokens,
  formatBytes,
  formatDuration,
  initialRunValues,
  pathOf,
  prettyBody,
  runAllOutcome,
  runInputsOf,
  secretSegments,
  textOf,
} from "./run-view";
import { runFixture } from "./testing";

const number = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat("en", options).format(value);

describe("run view helpers", () => {
  it("opens on the first failed step, otherwise the last", () => {
    expect(defaultStepIndex([{ status: "passed" }, { status: "failed" }, { status: "skipped" }])).toBe(1);
    expect(defaultStepIndex([{ status: "passed" }, { status: "passed" }])).toBe(1);
    expect(defaultStepIndex([])).toBe(0);
  });

  it("cuts text at the secret placeholders", () => {
    expect(secretSegments("Bearer {{secret.apiKey}} and {{ secret.other }}")).toEqual([
      { text: "Bearer " },
      { secret: "apiKey" },
      { text: " and " },
      { secret: "other" },
    ]);
    expect(secretSegments("plain")).toEqual([{ text: "plain" }]);
    expect(secretSegments("")).toEqual([]);
  });

  it("shows a body as pretty JSON for objects and arrays, as text otherwise", () => {
    expect(prettyBody({ a: 1 })).toEqual({ kind: "json", text: '{\n  "a": 1\n}' });
    expect(prettyBody([1])).toEqual({ kind: "json", text: "[\n  1\n]" });
    expect(prettyBody("<html>")).toEqual({ kind: "text", text: "<html>" });
    expect(prettyBody(42)).toEqual({ kind: "text", text: "42" });
    expect(prettyBody(null)).toBeUndefined();
    expect(prettyBody("")).toBeUndefined();
    expect(textOf("x")).toBe("x");
    expect(textOf({ a: true })).toBe('{"a":true}');
  });

  it("formats durations and sizes", () => {
    expect(formatDuration(840, number)).toBe("840 ms");
    expect(formatDuration(2430, number)).toBe("2.4 s");
    expect(formatBytes(512, number)).toBe("512 B");
    expect(formatBytes(1300, number)).toBe("1.3 KB");
    expect(formatBytes(3 * 1024 * 1024, number)).toBe("3 MB");
  });

  it("writes each check's rule", () => {
    expect(checkRule({ type: "status", equals: 200 })).toBe("status == 200");
    expect(checkRule({ type: "duration", maxMs: 500 })).toBe("durationMs < 500");
    expect(checkRule({ type: "path", path: "body.token", op: "exists", value: null })).toBe("body.token exists");
    expect(checkRule({ type: "path", path: "body.total", op: ">", value: 0 })).toBe('body.total > 0');
    expect(checkRule({ type: "path", path: "body.name", op: "==", value: "shoes" })).toBe('body.name == "shoes"');
  });

  it("keeps the path and query of a sent URL", () => {
    expect(pathOf("https://shop.example.com/v1/products?q=shoes")).toBe("/v1/products?q=shoes");
    expect(pathOf("not a url")).toBe("not a url");
  });

  it("types the run form's values and leaves out the empty ones", () => {
    const inputs = [
      { name: "q", type: "text" as const },
      { name: "limit", type: "number" as const },
      { name: "fresh", type: "boolean" as const },
      { name: "empty", type: "text" as const },
      { name: "odd", type: "number" as const },
    ];
    expect(runInputsOf(inputs, { q: " shoes ", limit: "10", fresh: "false", empty: "  ", odd: "ten" })).toEqual({
      q: " shoes ",
      limit: 10,
      fresh: false,
      odd: "ten",
    });
    expect(initialRunValues([{ name: "q", default: "shoes" }, { name: "x", default: null }])).toEqual({ q: "shoes", x: "" });
  });

  it("names how each flow of a Run all ended", () => {
    const run = runFixture({ status: "passed" });
    expect(runAllOutcome({ run })).toEqual({ kind: "passed", run });
    expect(runAllOutcome({ run: runFixture() }).kind).toBe("failed");
    expect(runAllOutcome({ error: new ApiError(422, "Some fields need attention.") }).kind).toBe("needsInputs");
    expect(runAllOutcome({ error: new ApiError(502, "AI could not write the inputs (x)") })).toEqual({
      kind: "aiUnavailable",
      message: "AI could not write the inputs (x)",
    });
    expect(runAllOutcome({ error: new ApiError(500, "boom") }).kind).toBe("error");
  });
});

describe("JSON bodies", () => {
  it("pretty-prints JSON that arrives as text, and keeps JSON cut short as it is", () => {
    expect(prettyBody('{"a":1}')).toEqual({ kind: "json", text: '{\n  "a": 1\n}' });
    expect(prettyBody('{"a": [1, 2… [99 more characters]')).toEqual({
      kind: "json",
      text: '{\n  "a": [\n    1,\n    2\n… [99 more characters]',
    });
    expect(prettyBody('{"a": {"b": "x, y: {z}"}, "c": [], "d": {}, "e": [{"f": "g\\"h"}]… [5 more characters]')).toEqual({
      kind: "json",
      text: '{\n  "a": {\n    "b": "x, y: {z}"\n  },\n  "c": [],\n  "d": {},\n  "e": [\n    {\n      "f": "g\\"h"\n    }\n  ]\n… [5 more characters]',
    });
    expect(prettyBody("plain words")).toEqual({ kind: "text", text: "plain words" });
    // Valid JSON text is indented as written: a big id and 1.0 stay exactly so.
    expect(prettyBody('{"id": 12345678901234567890, "v": 1.0}')).toEqual({
      kind: "json",
      text: '{\n  "id": 12345678901234567890,\n  "v": 1.0\n}',
    });
    // A cut body the backend already indented keeps the same layout.
    expect(prettyBody('{\n  "a": 1,\n… [9 more characters]')).toEqual({ kind: "json", text: '{\n  "a": 1,\n… [9 more characters]' });
    // Compact JSON with a trailing newline, or only partly broken into lines, is indented too.
    expect(prettyBody('{"a":1,"b":[2]}\n')).toEqual({ kind: "json", text: '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}' });
    expect(prettyBody('{"a": 1,\n"b": {"c": "x y"}}')).toEqual({ kind: "json", text: '{\n  "a": 1,\n  "b": {\n    "c": "x y"\n  }\n}' });
    // Text that only looks like JSON stays exactly as received.
    expect(prettyBody("{not json, a: b}")).toEqual({ kind: "text", text: "{not json, a: b}" });
  });

  it("tells keys from values", () => {
    const tokens = jsonTokens('{\n  "name": "pikachu",\n  "id": 25,\n  "is_default": true,\n  "past": null,\n  "note": "a \\"quoted\\": word"\n}');
    const of = (kind: string) => tokens.filter((token) => token.kind === kind).map((token) => token.text);
    expect(of("key")).toEqual(['"name"', '"id"', '"is_default"', '"past"', '"note"']);
    expect(of("string")).toEqual(['"pikachu"', '"a \\"quoted\\": word"']);
    expect(of("number")).toEqual(["25"]);
    expect(of("literal")).toEqual(["true", "null"]);
    expect(jsonTokens("… [99 more characters]").filter((token) => token.kind === "number")).toEqual([
      { kind: "number", text: "99" },
    ]);
    expect(jsonTokens("v2 ok").some((token) => token.kind === "number")).toBe(false);
    expect(tokens.map((token) => token.text).join("")).toBe('{\n  "name": "pikachu",\n  "id": 25,\n  "is_default": true,\n  "past": null,\n  "note": "a \\"quoted\\": word"\n}');
  });
});
