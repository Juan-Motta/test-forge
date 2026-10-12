"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

/** The signed-in user, as returned by `GET /api/auth/me`. */
export type SessionUser = { id: string; email: string; displayName: string };

export const sessionQueryKey = ["auth", "session"] as const;

export function fetchSession(signal?: AbortSignal): Promise<SessionUser> {
  return apiFetch<SessionUser>("/auth/me", { signal });
}

/**
 * Current user. A 401 sends the browser to the login page (see `apiFetch`). It only changes on
 * sign-in (which seeds this cache) and sign-out (a full reload), so it never goes stale: remounts
 * reuse it instead of refetching.
 */
export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
