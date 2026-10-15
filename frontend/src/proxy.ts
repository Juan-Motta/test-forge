import { NextResponse, type NextRequest } from "next/server";
import { guardRoute, SESSION_COOKIE_NAME } from "@/features/auth/route-guard";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { resolveLocale } from "@/lib/i18n/resolve";

/** `/es/runs` → `es` and `/runs`; a path without a locale prefix → null and the path itself. */
function splitLocale(pathname: string): { prefix: string | null; path: string } {
  const [, first, ...rest] = pathname.split("/");
  return isLocale(first) ? { prefix: first, path: `/${rest.join("/")}` } : { prefix: null, path: pathname };
}

/**
 * Auth gate, then language: URLs carry no language, so `/runs` is served from the prerendered
 * `/<locale>/runs` (`app/[lang]`) of the visitor's language (cookie, else Accept-Language, else
 * English). The proxy also sees its own rewrite (`/en/runs`): that passes through, and the guard
 * always checks the path without its prefix so `next=` stays the clean URL.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { prefix, path } = splitLocale(pathname);
  const decision = guardRoute({ pathname: path, search, hasSessionCookie: request.cookies.has(SESSION_COOKIE_NAME) });
  if (decision.type === "redirect") return NextResponse.redirect(new URL(decision.location, request.url));
  if (prefix) return NextResponse.next();

  const locale = resolveLocale({
    cookie: request.cookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: request.headers.get("accept-language"),
  });
  const target = request.nextUrl.clone();
  target.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(target);
}

export const config = {
  // Page routes only: skip the API rewrite, Next internals and files with an extension.
  matcher: ["/((?!api/|_next/static|_next/image|.*\\.[^/]+$).*)"],
};
