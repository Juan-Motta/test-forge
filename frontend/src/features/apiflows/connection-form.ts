import type { ApiChanges, ApiHeader, ApiSecret } from "./types";

/** An API holds at most this many secrets (the backend refuses more). */
export const MAX_SECRETS = 10;

/** One name/value row of a form; `locked` marks a stored secret (its name is fixed, its value unknown). */
export type PairRow = { key: string; name: string; value: string; locked?: boolean };

/** Gives each new row a key unique within the form. */
export function rowKeys(prefix: string) {
  let next = 0;
  return () => `${prefix}-${(next += 1)}`;
}

/** Rows with a name or a value: a fully blank row is ignored. */
const filled = (rows: PairRow[]) => rows.filter((row) => row.name.trim() || row.value);

export function headersOf(rows: PairRow[]): ApiHeader[] {
  return filled(rows).map((row) => ({ name: row.name.trim(), value: row.value }));
}

/** New secrets by name, for a create (values as typed). */
export function secretsOf(rows: PairRow[]): Record<string, string> {
  return Object.fromEntries(filled(rows).map((row) => [row.name.trim(), row.value]));
}

/** Why the rows cannot be saved: a value without a name, a repeated name, or a new secret without a value. */
export function rowsProblem(rows: PairRow[], kind: "header" | "secret"): "name" | "duplicate" | "value" | undefined {
  const kept = filled(rows);
  if (kept.some((row) => !row.name.trim())) return "name";
  const names = kept.map((row) => (kind === "header" ? row.name.trim().toLowerCase() : row.name.trim()));
  if (new Set(names).size !== names.length) return "duplicate";
  if (kind === "secret" && kept.some((row) => !row.locked && !row.value)) return "value";
  return undefined;
}

/**
 * What an edit changes in the secrets: a typed value for a kept or new one, `null` for one that
 * was removed; untouched secrets are left out (their values are never sent back).
 */
export function secretChanges(stored: ApiSecret[], rows: PairRow[]): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  const kept = new Set(rows.filter((row) => row.locked).map((row) => row.name));
  for (const secret of stored) if (!kept.has(secret.name)) changes[secret.name] = null;
  for (const row of filled(rows)) if (row.value) changes[row.name.trim()] = row.value;
  return changes;
}

/** The connection part of a PATCH: only what differs from the stored API. */
export function connectionChanges(
  stored: { baseUrl: string; headers: ApiHeader[]; secrets: ApiSecret[] },
  form: { baseUrl: string; headers: PairRow[]; secrets: PairRow[] },
): ApiChanges {
  const changes: ApiChanges = {};
  const baseUrl = form.baseUrl.trim();
  if (baseUrl !== stored.baseUrl) changes.baseUrl = baseUrl;
  const headers = headersOf(form.headers);
  if (JSON.stringify(headers) !== JSON.stringify(stored.headers)) changes.headers = headers;
  const secrets = secretChanges(stored.secrets, form.secrets);
  if (Object.keys(secrets).length > 0) changes.secrets = secrets;
  return changes;
}

/** The first field error whose path starts with `prefix` (`headers.0.name` belongs to `headers`). */
export function fieldError(errors: Record<string, string>, prefix: string): string | undefined {
  const key = Object.keys(errors).find((name) => name === prefix || name.startsWith(`${prefix}.`));
  return key === undefined ? undefined : errors[key];
}
