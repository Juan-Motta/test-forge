import { describe, expect, it } from "vitest";
import { valueSource } from "./value-source";

const inputs = [
  { name: "query", generate: "A product a guest would search for" },
  { name: "limit", generate: null },
];

describe("valueSource", () => {
  it("calls plain text fixed", () => {
    expect(valueSource("application/json", inputs)).toBe("fixed");
    expect(valueSource("", inputs)).toBe("fixed");
    expect(valueSource("{{other.x}}", inputs)).toBe("fixed");
  });

  it("calls a value made of secrets an API secret", () => {
    expect(valueSource("{{secret.apiKey}}", inputs)).toBe("secret");
    expect(valueSource("{{ secret.apiKey }}", inputs)).toBe("secret");
    expect(valueSource("Key {{secret.apiKey}}", inputs)).toBe("secret");
  });

  it("calls {{var.x}} a connection variable, or an API secret when x is one of the API's secrets", () => {
    const secrets = new Set(["password"]);
    expect(valueSource("{{var.tenant_id}}", inputs, secrets)).toBe("variable");
    expect(valueSource("v{{ var.api_version }}", inputs)).toBe("variable");
    expect(valueSource("{{var.password}}", inputs, secrets)).toBe("secret");
    expect(valueSource("{{var.tenant_id}}:{{var.password}}", inputs, secrets)).toBe("secret");
    expect(valueSource("{{input.limit}} {{var.tenant_id}}", inputs, secrets)).toBe("input");
  });

  it("calls a value with a saved value from a step, even beside other sources", () => {
    expect(valueSource("Bearer {{saved.token}}", inputs)).toBe("saved");
    expect(valueSource("{{input.query}}-{{saved.token}}", inputs)).toBe("saved");
  });

  it("tells an input AI writes from a plain input", () => {
    expect(valueSource("{{input.query}}", inputs)).toBe("generated");
    expect(valueSource("{{input.limit}}", inputs)).toBe("input");
    expect(valueSource("{{input.unknown}}", inputs)).toBe("input");
    expect(valueSource("{{input.limit}} {{secret.apiKey}}", inputs)).toBe("input");
  });
});
