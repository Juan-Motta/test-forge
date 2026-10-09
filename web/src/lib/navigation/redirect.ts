import { loginHref } from "./next-param";

/** Full navigation to the login page, remembering where the user was. No-op on the login page. */
export function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (pathname === "/login") return;
  window.location.assign(loginHref(`${pathname}${search}`));
}

/**
 * Full page load that replaces the current history entry. Used after sign-out so nothing the
 * previous user loaded survives in memory (query cache, component state).
 */
export function replaceLocation(path: string): void {
  if (typeof window === "undefined") return;
  window.location.replace(path);
}
