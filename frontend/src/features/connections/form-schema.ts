import { z } from "zod";
import type { Translator } from "@/lib/i18n";
import { KINDS, type FieldFormat } from "./kinds";
import {
  CONNECTION_KINDS,
  type Connection,
  type ConnectionChanges,
  type ConnectionConfig,
  type ConnectionKind,
  type ConnectionSecrets,
  type DraftConnection,
  type NewConnection,
} from "./types";

/**
 * Form state. Field names match the API's error locations (`name`, `config.baseUrl`,
 * `secrets.apiKey`), so server field errors land on the inputs without translation.
 */
export type ConnectionFormValues = {
  kind: ConnectionKind;
  name: string;
  config: ConnectionConfig;
  secrets: ConnectionSecrets;
};

export type FormIssue = { path: string; message: string };

// Limits and patterns mirror the backend's domain models (connections/domain.py).
const MAX_NAME = 120;
const MAX_URL = 2048;
const MAX_SECRET = 4096;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,100}$/;
const REGION = /^[a-z0-9]{1,40}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
/** Secrets travel in HTTP headers: visible ASCII only, like the backend's `check_header_safe`. */
const HEADER_SAFE = /^[\x21-\x7e]*$/;

function hasUnsafeCharacter(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return /\s/.test(char) || char === "\\" || code < 0x20 || code === 0x7f;
  });
}

/** Same rules as the backend's `check_url`; `http://localhost` is left for the server to judge. */
export function urlProblem(t: Translator, value: string): string | undefined {
  if (value.length > MAX_URL) return t("agents.url.tooLong");
  if (hasUnsafeCharacter(value)) return t("agents.url.unsafe");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return t("connections.error.absolute");
  }
  if (!url.hostname) return t("connections.error.absolute");
  if (url.username || url.password || value.split("//")[1]?.split("/")[0].includes("@")) {
    return t("agents.url.credentials");
  }
  if (url.search || url.hash || value.endsWith("?") || value.endsWith("#")) {
    return t("agents.url.query");
  }
  const localHttp = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !localHttp) return t("connections.error.https");
  return undefined;
}

const FORMAT_CHECKS: Record<FieldFormat, (t: Translator, value: string) => string | undefined> = {
  url: urlProblem,
  identifier: (t, value) => (IDENTIFIER.test(value) ? undefined : t("connections.error.identifier")),
  region: (t, value) => (REGION.test(value) ? undefined : t("connections.error.region")),
};

/**
 * A blank (or whitespace-only) secret means "none typed": required on create, "keep the stored
 * one" on edit. A typed secret is never trimmed: surrounding whitespace is reported instead of
 * silently changing a key the user pasted.
 */
function secretProblem(
  t: Translator,
  secret: string,
  label: string,
  options: { secretRequired: boolean },
): string | undefined {
  if (!secret.trim()) return options.secretRequired ? t("connections.error.enter", { field: label }) : undefined;
  if (secret !== secret.trim()) return t("connections.error.secretSpaces", { field: label });
  if (!HEADER_SAFE.test(secret)) return t("connections.error.secretAscii", { field: label });
  if (secret.length > MAX_SECRET) return t("common.maxChars", { max: MAX_SECRET });
  return undefined;
}

/** Problems with the kind-specific part of the form: config fields and, if required, the secret. */
export function draftIssues(
  t: Translator,
  values: Pick<ConnectionFormValues, "kind" | "config" | "secrets">,
  options: { secretRequired: boolean },
): FormIssue[] {
  const kind = KINDS[values.kind];
  const issues: FormIssue[] = [];
  for (const field of kind.config) {
    const value = (values.config[field.key] ?? "").trim();
    const path = `config.${field.key}`;
    if (!value) {
      if (field.required) issues.push({ path, message: t("connections.error.enter", { field: t(field.label).toLowerCase() }) });
      continue;
    }
    const problem = FORMAT_CHECKS[field.format](t, value);
    if (problem) issues.push({ path, message: problem });
  }
  if (kind.exactlyOneOf) {
    const [first, second] = kind.exactlyOneOf;
    const set = [first, second].filter((key) => (values.config[key] ?? "").trim());
    if (set.length === 0) issues.push({ path: `config.${first}`, message: t("connections.error.regionOrEndpoint") });
    if (set.length === 2) issues.push({ path: `config.${second}`, message: t("connections.error.notBoth") });
  }
  const secretIssue = secretProblem(t, values.secrets[kind.secret.key] ?? "", t(kind.secret.label), options);
  if (secretIssue) issues.push({ path: `secrets.${kind.secret.key}`, message: secretIssue });
  return issues;
}

export function connectionFormSchema(t: Translator, options: { secretRequired: boolean }) {
  return z
    .object({
      kind: z.enum(CONNECTION_KINDS),
      name: z
        .string()
        .trim()
        .min(1, t("connections.error.name"))
        .max(MAX_NAME, t("common.maxChars", { max: MAX_NAME })),
      config: z.record(z.string(), z.string()),
      secrets: z.record(z.string(), z.string()),
    })
    .superRefine((values, ctx) => {
      for (const issue of draftIssues(t, values, options)) {
        ctx.addIssue({ code: "custom", path: issue.path.split("."), message: issue.message });
      }
    });
}

/** The kind's config with blank values dropped (the backend then applies its defaults). */
export function cleanConfig(kind: ConnectionKind, config: ConnectionConfig): ConnectionConfig {
  const clean: ConnectionConfig = {};
  for (const field of KINDS[kind].config) {
    const value = (config[field.key] ?? "").trim();
    if (value) clean[field.key] = value;
  }
  return clean;
}

/** The typed secret as is, or `undefined` when the field was left blank or holds only whitespace. */
function typedSecrets(kind: ConnectionKind, secrets: ConnectionSecrets): ConnectionSecrets | undefined {
  const key = KINDS[kind].secret.key;
  return secrets[key]?.trim() ? { [key]: secrets[key] } : undefined;
}

export function hasTypedSecret(values: Pick<ConnectionFormValues, "kind" | "secrets">): boolean {
  return typedSecrets(values.kind, values.secrets) !== undefined;
}

function storedString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Values for a kind picked on create: its defaults and an empty secret. */
export function valuesForKind(kind: ConnectionKind): Pick<ConnectionFormValues, "config" | "secrets"> {
  return {
    config: Object.fromEntries(KINDS[kind].config.map((field) => [field.key, field.defaultValue ?? ""])),
    secrets: { [KINDS[kind].secret.key]: "" },
  };
}

/** Initial values: the kind's defaults on create; the stored config (never a secret) on edit. */
export function initialValues(connection?: Connection): ConnectionFormValues {
  if (!connection) return { kind: "openai", name: "", ...valuesForKind("openai") };
  const { kind } = connection;
  return {
    kind,
    name: connection.name,
    config: Object.fromEntries(KINDS[kind].config.map((field) => [field.key, storedString(connection.config[field.key])])),
    secrets: { [KINDS[kind].secret.key]: "" },
  };
}

export function toDraft(values: ConnectionFormValues): DraftConnection {
  return {
    kind: values.kind,
    config: cleanConfig(values.kind, values.config),
    secrets: typedSecrets(values.kind, values.secrets) ?? {},
  };
}

export function toNewConnection(values: ConnectionFormValues): NewConnection {
  return { name: values.name.trim(), ...toDraft(values) };
}

/**
 * Only what changed: a PATCH with `config` or `secrets` clears the last test, and omitting
 * `secrets` keeps the stored ones.
 */
export function toChanges(connection: Connection, values: ConnectionFormValues): ConnectionChanges {
  const changes: ConnectionChanges = {};
  const name = values.name.trim();
  if (name !== connection.name) changes.name = name;
  const config = cleanConfig(connection.kind, values.config);
  const configChanged = KINDS[connection.kind].config.some(
    (field) => (config[field.key] ?? "") !== storedString(connection.config[field.key]),
  );
  if (configChanged) changes.config = config;
  const secrets = typedSecrets(connection.kind, values.secrets);
  if (secrets) changes.secrets = secrets;
  return changes;
}
