// @vitest-environment node
import { describe, expect, it } from "vitest";
import { guardRoute } from "./route-guard";

describe("guardRoute", () => {
  it("redirects an app route to login with next when the session cookie is absent", () => {
    expect(guardRoute({ pathname: "/runs", search: "?status=failed", hasSessionCookie: false })).toEqual({
      type: "redirect",
      location: "/login?next=%2Fruns%3Fstatus%3Dfailed",
    });
  });

  it("redirects the home page to a bare login", () => {
    expect(guardRoute({ pathname: "/", search: "", hasSessionCookie: false })).toEqual({
      type: "redirect",
      location: "/login",
    });
  });

  it("lets the request through when the cookie is present (the backend decides validity)", () => {
    expect(guardRoute({ pathname: "/runs", search: "", hasSessionCookie: true })).toEqual({ type: "next" });
  });

  it.each(["/login", "/_next/static/chunks/app.js", "/_next/image", "/icon.svg", "/favicon.ico", "/api/auth/me"])(
    "never redirects %s",
    (pathname) => {
      expect(guardRoute({ pathname, search: "", hasSessionCookie: false })).toEqual({ type: "next" });
    },
  );
});
