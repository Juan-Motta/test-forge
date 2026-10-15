import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n";
import { apiKeyStatus, curlExample, maskedPrefix, statusLabel } from "./format";

const t = createTranslator("en");
import { apiKeyFixture } from "./testing";

const NOW = Date.parse("2026-10-11T12:00:00Z");

describe("apiKeyStatus", () => {
  it.each([
    ["active without expiry", {}, "active"],
    ["active before it expires", { expiresAt: "2026-10-12T00:00:00Z" }, "active"],
    ["expired once its expiry passed", { expiresAt: "2026-10-11T11:59:59Z" }, "expired"],
    ["revoked wins over expired", { expiresAt: "2026-01-01T00:00:00Z", revokedAt: "2026-02-01T00:00:00Z" }, "revoked"],
  ] as const)("%s", (_, overrides, expected) => {
    expect(apiKeyStatus(apiKeyFixture(overrides), NOW)).toBe(expected);
  });

  it("labels each status", () => {
    expect([statusLabel(t, "active"), statusLabel(t, "revoked"), statusLabel(t, "expired")]).toEqual([
      "Active",
      "Revoked",
      "Expired",
    ]);
  });
});

describe("maskedPrefix", () => {
  it("shows the prefix followed by an ellipsis", () => {
    expect(maskedPrefix("ve_abcd1234")).toBe("ve_abcd1234…");
  });

  it("adds the ve_ marker when the API returns the bare prefix", () => {
    expect(maskedPrefix("abcd1234")).toBe("ve_abcd1234…");
  });
});

describe("curlExample", () => {
  it("calls the runs endpoint with the key as a bearer token", () => {
    expect(curlExample("ve_x_y", "https://eval.example.com")).toBe(
      'curl -H "Authorization: Bearer ve_x_y" https://eval.example.com/api/runs',
    );
  });
});
