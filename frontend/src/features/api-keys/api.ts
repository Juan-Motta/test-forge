import { ApiError, apiFetch } from "@/lib/api";
import { errorFromResponse, NETWORK_MESSAGE } from "@/lib/api/errors";
import type { ApiKey, CreatedApiKey, NewApiKey } from "./types";

const BASE = "/api-keys";

export function listApiKeys(signal?: AbortSignal): Promise<ApiKey[]> {
  return apiFetch<ApiKey[]>(BASE, { signal });
}

/** The only response that carries the full secret (`key`). */
export function createApiKey(input: NewApiKey): Promise<CreatedApiKey> {
  return apiFetch<CreatedApiKey>(BASE, { method: "POST", body: input });
}

export function revokeApiKey(id: string): Promise<void> {
  return apiFetch<void>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Fetches the agent skill folder as a zip with the session cookie. `apiFetch` parses JSON, so the
 * binary body is read here; errors still surface as `ApiError` with the server's message.
 */
export async function fetchSkillZip(): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(new URL("/api/skill.zip", window.location.origin), {
      headers: { Accept: "application/zip" },
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE);
  }
  if (!response.ok) throw await errorFromResponse(response);
  return response.blob();
}
