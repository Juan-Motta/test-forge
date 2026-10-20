/**
 * Export and import of agent and scenario configs as text: a JSON object tagged with what it is
 * (`testforge`; files exported before the rename say `duet` and are still accepted) and the
 * format version. References to other records travel by name, never by id, so a config moves
 * between environments; secrets never travel.
 */
export const TRANSFER_VERSION = 1;

export type TransferKind = "agent" | "scenario";

export type ParsedTransfer = { ok: true; data: Record<string, unknown> } | { ok: false; error: "json" | "kind" | "version" };

/** The text to save or share: pretty-printed so it reads and diffs well. */
export function toTransferText(kind: TransferKind, config: Record<string, unknown>): string {
  return `${JSON.stringify({ testforge: kind, version: TRANSFER_VERSION, ...config }, null, 2)}\n`;
}

/** The config inside a pasted or uploaded text, or why it cannot be one of `kind`. */
export function parseTransfer(text: string, kind: TransferKind): ParsedTransfer {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "json" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "json" };
  const { testforge, duet, version, ...data } = value as Record<string, unknown>;
  if ((testforge ?? duet) !== kind) return { ok: false, error: "kind" };
  if (version !== TRANSFER_VERSION) return { ok: false, error: "version" };
  return { ok: true, data };
}

/** A file name for the download: the record's name, slugged, then `.agent.json` or `.scenario.json`. */
export function transferFileName(kind: TransferKind, name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || kind}.${kind}.json`;
}

/** Readers that keep an imported value only when it has the expected type. */
export const read = {
  string: (value: unknown): string | undefined => (typeof value === "string" ? value : undefined),
  number: (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined),
  oneOf: <T extends string>(options: readonly T[], value: unknown): T | undefined =>
    typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : undefined,
  array: (value: unknown): unknown[] => (Array.isArray(value) ? value : []),
  object: (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {},
};

/** The id of the record named `name` (case-insensitive, trimmed), if there is exactly one. */
export function idByName(records: readonly { id: string; name: string }[], name: unknown): string | undefined {
  if (typeof name !== "string" || !name.trim()) return undefined;
  const wanted = name.trim().toLowerCase();
  const matches = records.filter((record) => record.name.trim().toLowerCase() === wanted);
  return matches.length === 1 ? matches[0].id : undefined;
}
