import { describe, expect, it } from "vitest";
import { connectionPayload, connectionRows, rowKeys, secretNameFor, type ConnectionForm, type StoredConnection } from "./connection-form";

const stored: StoredConnection = {
  headers: [
    { name: "x-api-key", value: "{{secret.x_api_key}}" },
    { name: "X-Key", value: "{{secret.apiKey}}" },
    { name: "Authorization", value: "Bearer {{secret.token}}" },
  ],
  secrets: [
    { name: "x_api_key", hint: "••••1" },
    { name: "apiKey", hint: "••••2" },
    { name: "token", hint: "••••3" },
    { name: "password", hint: "••••4" },
  ],
};

describe("secretNameFor", () => {
  it("lowercases the header name and turns every other character into _", () => {
    expect(secretNameFor("X-Api-Key")).toBe("x_api_key");
    expect(secretNameFor("Ocp-Apim-Subscription.Key")).toBe("ocp_apim_subscription_key");
  });

  it("starts with _ when the header starts with a digit, and keeps at most 40 characters", () => {
    expect(secretNameFor("3scale-key")).toBe("_3scale_key");
    expect(secretNameFor("a".repeat(50))).toBe("a".repeat(40));
  });

  it("adds _2, _3 when the name is taken, still within 40 characters", () => {
    expect(secretNameFor("token", new Set(["token"]))).toBe("token_2");
    expect(secretNameFor("token", new Set(["token", "token_2"]))).toBe("token_3");
    expect(secretNameFor("a".repeat(50), new Set(["a".repeat(40)]))).toBe(`${"a".repeat(38)}_2`);
  });
});

describe("connectionRows", () => {
  it("shows a header whose whole value is a stored secret as a secret header, and the rest as plain", () => {
    const rows = connectionRows(stored, rowKeys("t"));
    expect(rows.headers.map(({ name, value, secret, stored: held }) => ({ name, value, secret, held }))).toEqual([
      { name: "x-api-key", value: "", secret: true, held: "x_api_key" },
      { name: "X-Key", value: "", secret: true, held: "apiKey" },
      { name: "Authorization", value: "Bearer {{secret.token}}", secret: false, held: undefined },
    ]);
    // Secrets no header sends as its whole value are secret variables.
    expect(rows.secrets.map((row) => row.name)).toEqual(["token", "password"]);
  });
});

describe("connectionPayload", () => {
  const form = (): ConnectionForm => connectionRows(stored, rowKeys("t"));

  it("sends nothing new for an untouched form", () => {
    expect(connectionPayload(stored, form())).toEqual({ headers: stored.headers, secrets: {} });
  });

  it("never deletes a removed header's secret: a step may still use it, and it stays as a variable", () => {
    const rows = form();
    rows.headers = rows.headers.filter((row) => row.name === "Authorization");
    expect(connectionPayload(stored, rows).secrets).toEqual({});
  });

  it("keeps the value typed for a secret variable named like a removed header's secret", () => {
    const rows = form();
    rows.headers = rows.headers.filter((row) => row.name !== "x-api-key");
    rows.secrets = [...rows.secrets, { key: "new", name: "x_api_key", value: "moved-to-body" }];
    expect(connectionPayload(stored, rows).secrets).toEqual({ x_api_key: "moved-to-body" });
  });

  it("keeps a secret another header still sends", () => {
    const rows = form();
    rows.headers = rows.headers.map((row) =>
      row.name === "x-api-key" ? { ...row, secret: false, value: "{{secret.x_api_key}}-plain" } : row,
    );
    expect(connectionPayload(stored, rows).secrets).toEqual({});
  });
});
