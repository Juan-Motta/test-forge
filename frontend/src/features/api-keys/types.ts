/** An API key as `GET /api/api-keys` returns it: never the secret, only its prefix. */
export type ApiKey = {
  id: string;
  name: string;
  /** The key's public prefix (`ve_abcd1234` or just `abcd1234`); enough to recognise it. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

/** `POST /api/api-keys` answers once with the full secret; it is never returned again. */
export type CreatedApiKey = ApiKey & { key: string };

export type NewApiKey = { name: string; expiresInDays: number | null };

export type ApiKeyStatus = "active" | "revoked" | "expired";
