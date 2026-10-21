import { describe, expect, it } from "vitest";
import {
  connectionRows,
  rowKeys,
  variableChanges,
  variableErrors,
  variablesProblem,
  type StoredConnection,
  type VariableRow,
} from "./connection-form";

const stored: StoredConnection = {
  headers: [{ name: "x-api-key", value: "{{secret.x_api_key}}" }],
  variables: { tenant_id: "acme", api_version: "2" },
  secrets: [
    { name: "x_api_key", hint: "••••1" },
    { name: "password", hint: "••••2" },
  ],
};
const rows = () => connectionRows(stored, rowKeys("t")).variables;
const edit = (all: VariableRow[], name: string, change: Partial<VariableRow>) =>
  all.map((row) => (row.name === name ? { ...row, ...change } : row));

describe("connectionRows", () => {
  it("keeps every header plain, as stored, and lists plain variables then secrets", () => {
    const form = connectionRows(stored, rowKeys("t"));
    expect(form.headers.map(({ name, value }) => ({ name, value }))).toEqual(stored.headers);
    expect(form.variables.map(({ name, value, secret }) => ({ name, value, secret }))).toEqual([
      { name: "tenant_id", value: "acme", secret: false },
      { name: "api_version", value: "2", secret: false },
      { name: "x_api_key", value: "", secret: true },
      { name: "password", value: "", secret: true },
    ]);
  });
});

describe("variableChanges", () => {
  it("sends nothing for untouched rows", () => {
    expect(variableChanges(stored, rows())).toEqual({ variables: {}, secrets: {} });
  });

  it("sends an edited plain value, a replaced secret, and null for removed ones", () => {
    const changed = edit(edit(rows(), "tenant_id", { value: "globex" }), "x_api_key", { value: "new" }).filter(
      (row) => row.name !== "api_version" && row.name !== "password",
    );
    expect(variableChanges(stored, changed)).toEqual({
      variables: { tenant_id: "globex", api_version: null },
      secrets: { x_api_key: "new", password: null },
    });
  });

  it("moves a variable between plain and secret with both keys", () => {
    expect(variableChanges(stored, edit(rows(), "tenant_id", { secret: true }))).toEqual({
      variables: { tenant_id: null },
      secrets: { tenant_id: "acme" },
    });
    expect(variableChanges(stored, edit(rows(), "password", { secret: false, value: "visible" }))).toEqual({
      variables: { password: "visible" },
      secrets: { password: null },
    });
  });

  it("re-adds a removed name as the other kind", () => {
    const changed = [...rows().filter((row) => row.name !== "tenant_id"), { key: "n", name: "tenant_id", value: "s", secret: true }];
    expect(variableChanges(stored, changed)).toEqual({ variables: { tenant_id: null }, secrets: { tenant_id: "s" } });
  });
});

describe("variablesProblem", () => {
  it("asks for a name steps can use, once", () => {
    expect(variablesProblem([{ key: "a", name: "", value: "v", secret: false }])).toBe("name");
    expect(variablesProblem([{ key: "a", name: "2fa", value: "v", secret: false }])).toBe("pattern");
    expect(variablesProblem([...rows(), { key: "a", name: "password", value: "v", secret: false }])).toBe("duplicate");
  });

  it("asks for a value where one is needed", () => {
    expect(variablesProblem([{ key: "a", name: "token", value: "", secret: true }])).toBe("value");
    expect(variablesProblem(edit(rows(), "password", { secret: false }))).toBe("value");
    expect(variablesProblem(edit(rows(), "tenant_id", { secret: true, value: "" }))).toBe("value");
    // A stored secret kept secret keeps its value; a plain value may be empty.
    expect(variablesProblem([...rows(), { key: "a", name: "empty", value: "", secret: false }])).toBeUndefined();
  });
});

describe("variableErrors", () => {
  it("puts an error on the row it names, and the rest on the section", () => {
    const errors = {
      "variables.tenant_id": "'tenant_id' is already a secret of this API",
      variables: "an API holds at most 30 variables",
      name: "Taken",
    };
    expect(variableErrors(errors, rows())).toEqual({
      byName: { tenant_id: "'tenant_id' is already a secret of this API" },
      section: "an API holds at most 30 variables",
    });
  });
});
