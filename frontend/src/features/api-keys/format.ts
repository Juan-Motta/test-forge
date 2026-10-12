import type { ApiKey, ApiKeyStatus } from "./types";

/** Revoked beats expired: a revoked key stays revoked whatever its expiry says. */
export function apiKeyStatus(key: Pick<ApiKey, "expiresAt" | "revokedAt">, now: number = Date.now()): ApiKeyStatus {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && Date.parse(key.expiresAt) <= now) return "expired";
  return "active";
}

const STATUS_LABELS: Record<ApiKeyStatus, string> = { active: "Active", revoked: "Revoked", expired: "Expired" };

export function statusLabel(status: ApiKeyStatus): string {
  return STATUS_LABELS[status];
}

/** `ve_abcd1234…`: the recognisable start of a key, never the secret part. */
export function maskedPrefix(prefix: string): string {
  return `${prefix.startsWith("ve_") ? prefix : `ve_${prefix}`}…`;
}

/** A first request to try the key against this deployment. */
export function curlExample(key: string, origin: string): string {
  return `curl -H "Authorization: Bearer ${key}" ${origin}/api/runs`;
}
