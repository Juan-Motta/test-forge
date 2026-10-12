import { apiFetch } from "@/lib/api";
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
