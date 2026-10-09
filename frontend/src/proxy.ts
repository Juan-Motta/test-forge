import { NextResponse, type NextRequest } from "next/server";
import { guardRoute, SESSION_COOKIE_NAME } from "@/features/auth/route-guard";

export function proxy(request: NextRequest) {
  const decision = guardRoute({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    hasSessionCookie: request.cookies.has(SESSION_COOKIE_NAME),
  });
  if (decision.type === "redirect") return NextResponse.redirect(new URL(decision.location, request.url));
  return NextResponse.next();
}

export const config = {
  // Page routes only: skip the API rewrite, Next internals and files with an extension.
  matcher: ["/((?!api/|_next/static|_next/image|.*\\.[^/]+$).*)"],
};
