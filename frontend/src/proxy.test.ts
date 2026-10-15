// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const ORIGIN = "http://localhost:3000";

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

const rewrittenTo = (response: Response) => response.headers.get("x-middleware-rewrite");
const SESSION = "ve_session=abc";

describe("proxy locale rewrite", () => {
  it("serves the language of the cookie without changing the URL", () => {
    const response = proxy(request("/runs?status=failed", { cookie: `${SESSION}; voice-eval-locale=es` }));
    expect(rewrittenTo(response)).toBe(`${ORIGIN}/es/runs?status=failed`);
    expect(response.headers.get("location")).toBeNull();
  });

  it("falls back to Accept-Language, then English", () => {
    expect(rewrittenTo(proxy(request("/login", { "accept-language": "es-MX,es;q=0.9" })))).toBe(`${ORIGIN}/es/login`);
    expect(rewrittenTo(proxy(request("/login", { "accept-language": "fr-FR" })))).toBe(`${ORIGIN}/en/login`);
    expect(rewrittenTo(proxy(request("/guide/faq")))).toBe(`${ORIGIN}/en/guide/faq`);
  });

  it("prefers the cookie over Accept-Language", () => {
    const response = proxy(request("/login", { cookie: "voice-eval-locale=en", "accept-language": "es" }));
    expect(rewrittenTo(response)).toBe(`${ORIGIN}/en/login`);
  });

  it("maps the home page to the locale root", () => {
    expect(rewrittenTo(proxy(request("/", { cookie: `${SESSION}; voice-eval-locale=es` })))).toBe(`${ORIGIN}/es`);
  });

  it("lets an already prefixed path (its own rewrite) through untouched", () => {
    for (const path of ["/en/login", "/es/guide", "/es/runs"]) {
      const response = proxy(request(path, { cookie: `${SESSION}; voice-eval-locale=en` }));
      expect(rewrittenTo(response), path).toBeNull();
      expect(response.headers.get("location"), path).toBeNull();
      expect(response.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("redirects to login with the clean URL in next, prefixed or not", () => {
    for (const path of ["/runs?status=failed", "/es/runs?status=failed"]) {
      const response = proxy(request(path));
      expect(response.status, path).toBe(307);
      expect(response.headers.get("location"), path).toBe(`${ORIGIN}/login?next=%2Fruns%3Fstatus%3Dfailed`);
    }
  });

  it("guards the locale root like the home page", () => {
    expect(proxy(request("/es")).headers.get("location")).toBe(`${ORIGIN}/login`);
  });
});
