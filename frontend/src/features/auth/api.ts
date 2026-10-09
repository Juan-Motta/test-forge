import { apiFetch } from "@/lib/api";
import type { SessionUser } from "./session";

export type Credentials = { email: string; password: string };
export type LoginResult = { user: SessionUser; expiresAt: string };

/** Opens a session; the backend sets the HttpOnly `ve_session` cookie. */
export function login(credentials: Credentials): Promise<LoginResult> {
  return apiFetch<LoginResult>("/auth/login", { method: "POST", body: credentials });
}

/** Revokes the current session and clears the cookie. */
export function logout(): Promise<void> {
  return apiFetch<void>("/auth/logout", { method: "POST" });
}
