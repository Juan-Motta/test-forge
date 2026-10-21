import type { ApiChanges, ApiHeader, ApiSecret } from "./types";

/** An API holds at most this many secrets (the backend refuses more). */
export const MAX_SECRETS = 10;
/** An API holds at most this many plain variables (the backend refuses more). */
export const MAX_VARIABLES = 30;

/** A name steps can use as `{{var.<name>}}`, like the backend's. */
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

/** One default header of the form: a plain template every step sends. */
export type HeaderRow = { key: string; name: string; value: string };

/**
 * One connection variable of the form. `secret` is its Secret switch. `stored` marks one the API
 * already holds (its name is then fixed) and whether it is stored as a secret. A stored secret
 * still secret keeps its value unless one is typed (`value` replaces it); any other row sends
 * its `value` as typed.
 */
export type VariableRow = { key: string; name: string; value: string; secret: boolean; stored?: { secret: boolean } };

/** What a connection holds on the server: default headers, plain variables, and the secrets' names and hints. */
export type StoredConnection = { headers: ApiHeader[]; variables: Record<string, string>; secrets: ApiSecret[] };

/** The connection as typed: its default headers and its variables, plain or secret. */
export type ConnectionForm = { headers: HeaderRow[]; variables: VariableRow[] };

/** Gives each new row a key unique within the form. */
export function rowKeys(prefix: string) {
  let next = 0;
  return () => `${prefix}-${(next += 1)}`;
}

/** The form's rows for a stored connection: its headers as stored, its plain variables, then its secrets. */
export function connectionRows(stored: StoredConnection, nextKey: () => string): ConnectionForm {
  const headers = stored.headers.map((header): HeaderRow => ({ key: nextKey(), name: header.name, value: header.value }));
  const variables = [
    ...Object.entries(stored.variables).map(
      ([name, value]): VariableRow => ({ key: nextKey(), name, value, secret: false, stored: { secret: false } }),
    ),
    ...stored.secrets.map(
      (secret): VariableRow => ({ key: nextKey(), name: secret.name, value: "", secret: true, stored: { secret: true } }),
    ),
  ];
  return { headers, variables };
}

/** A new, empty plain variable. */
export const newVariable = (key: string): VariableRow => ({ key, name: "", value: "", secret: false });

/** Header rows with a name or a value: a fully blank row is ignored. */
const filledHeaders = (rows: HeaderRow[]) => rows.filter((row) => row.name.trim() || row.value);
/** Variable rows that count: stored ones, and new ones with a name or a value. */
const filledVariables = (rows: VariableRow[]) => rows.filter((row) => row.stored || row.name.trim() || row.value);
const nameOf = (row: VariableRow) => (row.stored ? row.name : row.name.trim());
/** Whether saving needs a typed value: a new or moved secret, and a stored secret turned plain. */
const needsValue = (row: VariableRow) => (row.secret ? !row.stored?.secret : Boolean(row.stored?.secret));

/**
 * The variable and secret changes a form sends: `null` for one removed (or moved to the other
 * kind), a value for one new, edited, replaced or moved. A stored secret left as it is is never
 * sent back, nor is a plain variable whose value did not change.
 */
export function variableChanges(
  stored: StoredConnection,
  rows: VariableRow[],
): { variables: Record<string, string | null>; secrets: Record<string, string | null> } {
  const variables: Record<string, string | null> = {};
  const secrets: Record<string, string | null> = {};
  const kept = filledVariables(rows);
  const keptPlain = new Set(kept.filter((row) => row.stored && !row.stored.secret).map(nameOf));
  const keptSecret = new Set(kept.filter((row) => row.stored?.secret).map(nameOf));
  for (const name of Object.keys(stored.variables)) if (!keptPlain.has(name)) variables[name] = null;
  for (const secret of stored.secrets) if (!keptSecret.has(secret.name)) secrets[secret.name] = null;
  for (const row of kept) {
    const name = nameOf(row);
    if (row.secret) {
      if (row.stored && !row.stored.secret) variables[name] = null;
      if (row.value || !row.stored?.secret) secrets[name] = row.value;
    } else {
      if (row.stored?.secret) secrets[name] = null;
      if (!row.stored || row.stored.secret || stored.variables[name] !== row.value) variables[name] = row.value;
    }
  }
  return { variables, secrets };
}

/** The default headers a form sends: plain templates, trimmed names. */
export function headersPayload(rows: HeaderRow[]): ApiHeader[] {
  return filledHeaders(rows).map((row) => ({ name: row.name.trim(), value: row.value }));
}

/** How many plain variables and secrets the form holds (every row counts, blank new ones too). */
export function variableCounts(rows: VariableRow[]): { plain: number; secret: number } {
  const secret = rows.filter((row) => row.secret).length;
  return { plain: rows.length - secret, secret };
}

/** A new API's headers, variables and secrets, as created. */
export function newConnection(form: ConnectionForm): {
  headers: ApiHeader[];
  variables: Record<string, string>;
  secrets: Record<string, string>;
} {
  const variables: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const row of filledVariables(form.variables)) (row.secret ? secrets : variables)[nameOf(row)] = row.value;
  return { headers: headersPayload(form.headers), variables, secrets };
}

/**
 * Why the variables cannot be saved: one without a name, a name steps cannot use, a repeated
 * name, or no value where one is needed (a new secret, a plain value made secret, a secret made plain).
 */
export function variablesProblem(rows: VariableRow[]): "name" | "pattern" | "duplicate" | "value" | undefined {
  const kept = filledVariables(rows);
  if (kept.some((row) => !nameOf(row))) return "name";
  if (kept.some((row) => !row.stored && !VARIABLE_NAME.test(nameOf(row)))) return "pattern";
  const names = kept.map(nameOf);
  if (new Set(names).size !== names.length) return "duplicate";
  if (kept.some((row) => needsValue(row) && !row.value)) return "value";
  return undefined;
}

/** Why the default headers cannot be saved: one without a name, or a repeated name. */
export function headersProblem(rows: HeaderRow[]): "name" | "duplicate" | undefined {
  const kept = filledHeaders(rows);
  if (kept.some((row) => !row.name.trim())) return "name";
  const names = kept.map((row) => row.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return "duplicate";
  return undefined;
}

/** The problems of a connection form, by section (`headers`, `variables`), as message keys' suffixes. */
export function connectionProblems(form: ConnectionForm) {
  return { headers: headersProblem(form.headers), variables: variablesProblem(form.variables) };
}

/** The connection part of a PATCH: only what differs from the stored API. */
export function connectionChanges(
  stored: { baseUrl: string } & StoredConnection,
  form: { baseUrl: string } & ConnectionForm,
): ApiChanges {
  const changes: ApiChanges = {};
  const baseUrl = form.baseUrl.trim();
  if (baseUrl !== stored.baseUrl) changes.baseUrl = baseUrl;
  const headers = headersPayload(form.headers);
  if (JSON.stringify(headers) !== JSON.stringify(stored.headers)) changes.headers = headers;
  const { variables, secrets } = variableChanges(stored, form.variables);
  if (Object.keys(variables).length > 0) changes.variables = variables;
  if (Object.keys(secrets).length > 0) changes.secrets = secrets;
  return changes;
}

/** Whether new variable rows hold anything typed (an unsaved edit a PATCH would not show yet). */
export const typedNewVariables = (rows: VariableRow[]) => rows.some((row) => !row.stored && (row.name.trim() || row.value));

/** The first field error whose path starts with `prefix` (`headers.0.name` belongs to `headers`). */
export function fieldError(errors: Record<string, string>, prefix: string): string | undefined {
  const key = Object.keys(errors).find((name) => name === prefix || name.startsWith(`${prefix}.`));
  return key === undefined ? undefined : errors[key];
}

/**
 * The server's errors of the variables: by row name (`variables.<name>…` or `secrets.<name>…`),
 * and the rest for the whole section (a limit, or a name no row holds any more).
 */
export function variableErrors(
  errors: Record<string, string>,
  rows: VariableRow[],
): { byName: Record<string, string>; section?: string } {
  const names = new Set(rows.map(nameOf).filter(Boolean));
  const byName: Record<string, string> = {};
  let section: string | undefined;
  for (const [key, message] of Object.entries(errors)) {
    const [field, name] = key.split(".");
    if (field !== "variables" && field !== "secrets") continue;
    if (name !== undefined && names.has(name)) byName[name] ??= message;
    else section ??= message;
  }
  return { byName, section };
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
