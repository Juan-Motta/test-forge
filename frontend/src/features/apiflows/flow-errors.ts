import type { FieldErrors } from "@/lib/api";

const LISTS = new Set(["query", "headers", "saves", "checks"]);
const isIndex = (part: string | undefined) => part !== undefined && /^\d+$/.test(part);

/**
 * The editor row a backend error location belongs to. `loc` comes dot-joined without its leading
 * `body` (see `ApiError.fieldErrors`), e.g. `steps.1.headers.0.value` → `steps.1.headers.0`,
 * `steps.0.body.key` → `steps.0.body`, `steps.0.checks.2.duration.maxMs` → `steps.0.checks.2`.
 */
export function flowErrorKey(path: string): string {
  const parts = path.split(".");
  if (parts[0] === "inputs" && isIndex(parts[1])) return `inputs.${parts[1]}`;
  if (parts[0] === "steps" && isIndex(parts[1])) {
    const step = `steps.${parts[1]}`;
    const field = parts[2];
    if (field === undefined) return step;
    if (LISTS.has(field) && isIndex(parts[3])) return `${step}.${field}.${parts[3]}`;
    return `${step}.${field}`;
  }
  return parts[0] ?? path;
}

/** Errors by editor row; the first message of a row is kept, verbatim. */
export function flowErrors(fieldErrors: FieldErrors): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [path, msg] of Object.entries(fieldErrors)) errors[flowErrorKey(path)] ??= msg;
  return errors;
}

const PLACED =
  /^(name|description|inputs\.\d+|steps\.\d+|steps\.\d+\.(title|method|path|body|query|headers|saves|checks)(\.\d+)?)$/;

/** Whether the editor shows this error beside a field; the others go in the form's alert. */
export const isPlaced = (key: string) => PLACED.test(key);
