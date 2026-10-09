/** Provider kinds the backend accepts (`ConnectionKind`). */
export const CONNECTION_KINDS = ["openai", "azure_openai", "azure_speech", "langfuse"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/** Outcome of the last connection test. `detail` is a status code and a generic reason. */
export type LastTest = { at: string; ok: boolean; detail: string };

/** A stored connection as `GET /api/connections` returns it: never a secret, only its hint. */
export type Connection = {
  id: string;
  name: string;
  kind: ConnectionKind;
  /** camelCase keys; absent optional values may come back as `null`. */
  config: Record<string, unknown>;
  /** `••••` plus the last 4 characters of the secret (only when it has 12+ characters). */
  secretHint: string;
  hasSecret: boolean;
  lastTest: LastTest | null;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionConfig = Record<string, string>;
export type ConnectionSecrets = Record<string, string>;

export type DraftConnection = { kind: ConnectionKind; config: ConnectionConfig; secrets: ConnectionSecrets };
export type NewConnection = DraftConnection & { name: string };
/** Omitted parts are kept; `config` and `secrets` replace the whole stored object. */
export type ConnectionChanges = { name?: string; config?: ConnectionConfig; secrets?: ConnectionSecrets };
