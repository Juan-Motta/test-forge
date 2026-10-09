import { describe, expect, it } from "vitest";
import { loginHref, sanitizeNext } from "./next-param";

describe("sanitizeNext", () => {
  it.each([
    ["/runs", "/runs"],
    ["/runs?status=failed#top", "/runs?status=failed#top"],
    ["/settings/connections", "/settings/connections"],
  ])("keeps the same-origin relative path %s", (input, expected) => {
    expect(sanitizeNext(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "runs",
    "//evil.com",
    "//evil.com/path",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "http://localhost:3000/runs",
    "javascript:alert(1)",
    "/%2F%2Fevil.com",
    "/runs\nLocation: x",
    "/login",
    "/login?next=/runs",
    // Dot segments that only become protocol-relative after URL normalization.
    "/.//evil.com",
    "/a/..//evil.com",
    "/%2e//evil.com",
    "/a/%2e%2e//evil.com/path",
  ])("falls back to / for %j", (input) => {
    expect(sanitizeNext(input)).toBe("/");
  });
});

describe("loginHref", () => {
  it("encodes a sanitized next path", () => {
    expect(loginHref("/runs?status=failed")).toBe("/login?next=%2Fruns%3Fstatus%3Dfailed");
  });

  it("omits next when it would just be the home page", () => {
    expect(loginHref("/")).toBe("/login");
    expect(loginHref("//evil.com")).toBe("/login");
  });
});
