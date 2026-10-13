import { loginHref } from "@/lib/navigation/next-param";

/** Backend session cookie name (`SESSION_COOKIE_NAME` on the backend; default `ve_session`). */
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "ve_session";

const PUBLIC_PATHS = new Set(["/login"]);
/** Public sections served with every sub-path (the user guide needs no session). */
const PUBLIC_SECTIONS = ["/guide"];
const PASSTHROUGH_PREFIXES = ["/_next/", "/api/"];
const FILE_EXTENSION = /\.[^/]+$/;

export type GuardDecision = { type: "next" } | { type: "redirect"; location: string };

/**
 * UX-only gate for page routes: without a session cookie there is no point rendering the app,
 * so go to login. A present cookie proves nothing; the backend still authorizes every call.
 */
export function guardRoute(input: { pathname: string; search: string; hasSessionCookie: boolean }): GuardDecision {
  const { pathname, search, hasSessionCookie } = input;
  if (
    hasSessionCookie ||
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_SECTIONS.some((section) => pathname === section || pathname.startsWith(`${section}/`)) ||
    pathname === "/_next" ||
    PASSTHROUGH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    FILE_EXTENSION.test(pathname)
  ) {
    return { type: "next" };
  }
  return { type: "redirect", location: loginHref(`${pathname}${search}`) };
}
