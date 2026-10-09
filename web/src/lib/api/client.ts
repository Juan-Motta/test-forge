import { redirectToLogin } from "@/lib/navigation/redirect";
import { ApiError, errorFromResponse, NETWORK_MESSAGE } from "./errors";

const API_PREFIX = "/api";
/** A 401 here means "wrong credentials", not "session expired": never bounce to login. */
const NO_REDIRECT_ON_401 = new Set(["/auth/login"]);

export type ApiRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

function resolve(path: string): string {
  const relative = `${API_PREFIX}${path}`;
  // Same origin as the page (Next rewrites /api to the backend); absolute for non-browser fetch.
  return typeof window === "undefined" ? relative : new URL(relative, window.location.origin).toString();
}

/**
 * Calls the backend through the same-origin `/api` prefix with the session cookie.
 *
 * Resolves with the parsed JSON body (`undefined` for 204) or rejects with `ApiError`.
 * A 401 from any call but login also sends the browser to `/login?next=<current path>`.
 */
export async function apiFetch<T = unknown>(path: string, request: ApiRequest = {}): Promise<T> {
  const { method = "GET", body, signal } = request;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(resolve(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
      signal,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new ApiError(0, NETWORK_MESSAGE);
  }

  if (!response.ok) {
    const error = await errorFromResponse(response);
    if (error.status === 401 && !NO_REDIRECT_ON_401.has(path)) redirectToLogin();
    throw error;
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, "The server sent an unreadable response.");
  }
}
