import type { ApiChanges, ApiHeader, ApiSecret } from "./types";

/** An API holds at most this many secrets (the backend refuses more). */
export const MAX_SECRETS = 10;

/** One name/value row of a form; `locked` marks a stored secret (its name is fixed, its value unknown). */
export type PairRow = { key: string; name: string; value: string; locked?: boolean };

/**
 * One header of the form. A secret header is sent as `{{secret.<name>}}` and its value is stored
 * sealed: `stored` names the secret it already holds (its `value` then replaces it only when
 * typed); without `stored`, saving creates a secret named after the header from `value`.
 * A stored secret header turned off keeps `stored`, so saving can drop the secret.
 */
export type HeaderRow = { key: string; name: string; value: string; secret: boolean; stored?: string };

/** What a connection holds on the server: plain headers and the secrets' names and hints. */
export type StoredConnection = { headers: ApiHeader[]; secrets: ApiSecret[] };

/** The connection as typed: its headers and the secret variables of the advanced section. */
export type ConnectionForm = { headers: HeaderRow[]; secrets: PairRow[] };

/** Gives each new row a key unique within the form. */
export function rowKeys(prefix: string) {
  let next = 0;
  return () => `${prefix}-${(next += 1)}`;
}

const MAX_NAME = 40;
const EXACT_SECRET = /^\{\{secret\.([A-Za-z_][A-Za-z0-9_]{0,39})\}\}$/;
const SECRET_REFS = /\{\{\s*secret\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** The header value that sends the secret `name`. */
export const secretRef = (name: string) => `{{secret.${name}}}`;

/**
 * The secret name a header's value is stored under: the header name lowercased, every other
 * character `_`, `_` first when it starts with a digit, at most 40 characters, and `_2`, `_3`…
 * when the name is already taken.
 */
export function secretNameFor(header: string, taken: ReadonlySet<string> = new Set()): string {
  let base = header.trim().toLowerCase().replace(/[^a-z0-9]/g, "_") || "_";
  if (/^[0-9]/.test(base)) base = `_${base}`;
  let name = base.slice(0, MAX_NAME);
  for (let n = 2; taken.has(name); n += 1) {
    const suffix = `_${n}`;
    name = base.slice(0, MAX_NAME - suffix.length) + suffix;
  }
  return name;
}

/** Whether `secret` is the one a secret header named `header` would have created. */
function derivedFrom(header: string, secret: string): boolean {
  const base = secretNameFor(header);
  if (secret === base) return true;
  const root = secret.replace(/_\d+$/, "");
  if (root === secret) return false;
  return root === base || (secret.length === MAX_NAME && base.startsWith(root));
}

/** The stored secrets a header sends as its whole value (`{{secret.name}}`): shown as secret headers. */
export function headerSecrets(stored: StoredConnection): Set<string> {
  const names = new Set(stored.secrets.map((secret) => secret.name));
  const bound = new Set<string>();
  for (const header of stored.headers) {
    const name = EXACT_SECRET.exec(header.value)?.[1];
    if (name !== undefined && names.has(name)) bound.add(name);
  }
  return bound;
}

/**
 * The form's rows for a stored connection: a header whose value is exactly a stored secret is a
 * secret header; any other header (`Bearer {{secret.token}}` too) is plain, as stored. Secrets no
 * header sends as its whole value are the advanced section's secret variables.
 */
export function connectionRows(stored: StoredConnection, nextKey: () => string): ConnectionForm {
  const bound = headerSecrets(stored);
  const headers = stored.headers.map((header): HeaderRow => {
    const name = EXACT_SECRET.exec(header.value)?.[1];
    return name !== undefined && bound.has(name)
      ? { key: nextKey(), name: header.name, value: "", secret: true, stored: name }
      : { key: nextKey(), name: header.name, value: header.value, secret: false };
  });
  const secrets = stored.secrets
    .filter((secret) => !bound.has(secret.name))
    .map((secret): PairRow => ({ key: nextKey(), name: secret.name, value: "", locked: true }));
  return { headers, secrets };
}

/** Rows with a name or a value: a fully blank row is ignored. */
const filled = (rows: PairRow[]) => rows.filter((row) => row.name.trim() || row.value);
/** Header rows that count: a name, a value, or a stored secret. */
const filledHeaders = (rows: HeaderRow[]) =>
  rows.filter((row) => row.name.trim() || row.value || (row.secret && row.stored));

/**
 * The headers and secret changes a connection form sends. A secret header sends its secret's
 * reference, plus its value when typed. A secret a stored secret header held is removed when no
 * header sends it any more and the header had created it (its name derives from the header's):
 * a secret named otherwise may be what a step's body uses, so it stays, as a secret variable.
 * Advanced secret variables send a typed value, or `null` when removed.
 */
export function connectionPayload(
  stored: StoredConnection,
  form: ConnectionForm,
): { headers: ApiHeader[]; secrets: Record<string, string | null> } {
  const bound = headerSecrets(stored);
  const secrets = secretChanges(
    stored.secrets.filter((secret) => !bound.has(secret.name)),
    form.secrets,
  );
  const taken = new Set([...stored.secrets.map((secret) => secret.name), ...filled(form.secrets).map((row) => row.name.trim())]);
  const headers = filledHeaders(form.headers).map((row): ApiHeader => {
    const name = row.name.trim();
    if (!row.secret) return { name, value: row.value };
    const secret = row.stored ?? secretNameFor(name, taken);
    taken.add(secret);
    if (row.value) secrets[secret] = row.value;
    return { name, value: secretRef(secret) };
  });
  const sent = new Set(headers.flatMap((header) => [...header.value.matchAll(SECRET_REFS)].map((match) => match[1])));
  for (const header of stored.headers) {
    const secret = EXACT_SECRET.exec(header.value)?.[1];
    if (secret !== undefined && bound.has(secret) && !sent.has(secret) && derivedFrom(header.name, secret)) {
      secrets[secret] = null;
    }
  }
  return { headers, secrets };
}

/** How many secrets the API would hold, counting new rows still blank (each will need one). */
export function secretCount(stored: StoredConnection, form: ConnectionForm): number {
  const names = new Set(stored.secrets.map((secret) => secret.name));
  for (const [name, value] of Object.entries(connectionPayload(stored, form).secrets)) {
    if (value === null) names.delete(name);
    else names.add(name);
  }
  const blank =
    form.secrets.filter((row) => !row.locked && !row.value).length +
    form.headers.filter((row) => row.secret && !row.stored && !row.value).length;
  return names.size + blank;
}

/** A new API's headers and secrets, as created. */
export function newConnection(form: ConnectionForm): { headers: ApiHeader[]; secrets: Record<string, string> } {
  const { headers, secrets } = connectionPayload({ headers: [], secrets: [] }, form);
  const values = Object.entries(secrets).filter((entry): entry is [string, string] => entry[1] !== null);
  return { headers, secrets: Object.fromEntries(values) };
}

/** Why the secret variables cannot be saved: a value without a name, a repeated name, or a new secret without a value. */
export function rowsProblem(rows: PairRow[], reserved: Iterable<string> = []): "name" | "duplicate" | "value" | undefined {
  const kept = filled(rows);
  if (kept.some((row) => !row.name.trim())) return "name";
  const names = [...rows.filter((row) => row.locked).map((row) => row.name), ...reserved];
  names.push(...kept.filter((row) => !row.locked).map((row) => row.name.trim()));
  if (new Set(names).size !== names.length) return "duplicate";
  if (kept.some((row) => !row.locked && !row.value)) return "value";
  return undefined;
}

/** Why the headers cannot be saved: one without a name, a repeated name, or a new secret header without a value. */
export function headersProblem(rows: HeaderRow[]): "name" | "duplicate" | "value" | undefined {
  const kept = filledHeaders(rows);
  if (kept.some((row) => !row.name.trim())) return "name";
  const names = kept.map((row) => row.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return "duplicate";
  if (kept.some((row) => row.secret && !row.stored && !row.value)) return "value";
  return undefined;
}

/**
 * The problems of a connection form, by field (`headers`, `secrets`), as message keys' suffixes.
 * A new secret variable may not take the name of a secret a header holds.
 */
export function connectionProblems(form: ConnectionForm) {
  const reserved = form.headers.flatMap((row) => (row.secret && row.stored ? [row.stored] : []));
  return { headers: headersProblem(form.headers), secrets: rowsProblem(form.secrets, reserved) };
}

/**
 * What an edit changes in the secret variables: a typed value for a kept or new one, `null` for
 * one that was removed; untouched secrets are left out (their values are never sent back).
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
  stored: { baseUrl: string } & StoredConnection,
  form: { baseUrl: string } & ConnectionForm,
): ApiChanges {
  const changes: ApiChanges = {};
  const baseUrl = form.baseUrl.trim();
  if (baseUrl !== stored.baseUrl) changes.baseUrl = baseUrl;
  const { headers, secrets } = connectionPayload(stored, form);
  if (JSON.stringify(headers) !== JSON.stringify(stored.headers)) changes.headers = headers;
  if (Object.keys(secrets).length > 0) changes.secrets = secrets;
  return changes;
}

/** The first field error whose path starts with `prefix` (`headers.0.name` belongs to `headers`). */
export function fieldError(errors: Record<string, string>, prefix: string): string | undefined {
  const key = Object.keys(errors).find((name) => name === prefix || name.startsWith(`${prefix}.`));
  return key === undefined ? undefined : errors[key];
}

/** Tags typed as one comma-separated line: trimmed, blanks dropped, each kept once. */
export function tagsOf(text: string): string[] {
  return [...new Set(text.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

/** A whole PATCH of an API's details: only what differs from the stored API. */
export function apiChanges(
  stored: { name: string; description: string; tags: string[]; baseUrl: string } & StoredConnection,
  form: { name: string; description: string; tags: string; baseUrl: string } & ConnectionForm,
): ApiChanges {
  const changes: ApiChanges = {};
  const name = form.name.trim();
  if (name !== stored.name) changes.name = name;
  const description = form.description.trim();
  if (description !== stored.description) changes.description = description;
  const tags = tagsOf(form.tags);
  if (JSON.stringify(tags) !== JSON.stringify(stored.tags)) changes.tags = tags;
  return { ...changes, ...connectionChanges(stored, form) };
}
