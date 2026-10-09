const HOME = "/";
const LOGIN = "/login";
const PLACEHOLDER_ORIGIN = "http://same-origin.invalid";

/**
 * Turns an untrusted `next` value into a same-origin relative path, or `/`.
 *
 * Rejects absolute and protocol-relative URLs (`//host`, `/\host`, also when percent-encoded),
 * control characters, and the login page itself (to avoid loops).
 */
export function sanitizeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return HOME;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return HOME;
  }
  for (const candidate of [value, decoded]) {
    if (/[\\\u0000-\u001f\u007f]/.test(candidate) || candidate.startsWith("//")) return HOME;
  }
  const url = new URL(value, PLACEHOLDER_ORIGIN);
  if (url.origin !== PLACEHOLDER_ORIGIN) return HOME;
  // Dot segments can normalize an accepted input into `//host`; re-check the path actually used.
  if (url.pathname.startsWith("//") || url.pathname.includes("\\")) return HOME;
  if (url.pathname === LOGIN || url.pathname.startsWith(`${LOGIN}/`)) return HOME;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Login page URL that brings the user back to `next` (sanitized) after signing in. */
export function loginHref(next: string | null | undefined): string {
  const target = sanitizeNext(next);
  return target === HOME ? LOGIN : `${LOGIN}?next=${encodeURIComponent(target)}`;
}
