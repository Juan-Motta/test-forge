import type { FlowInput } from "./types";

/** Where a step value comes from, as its chip shows it. */
export type ValueSource = "fixed" | "input" | "secret" | "saved" | "generated";

export const VALUE_SOURCES: readonly ValueSource[] = ["fixed", "input", "secret", "saved", "generated"];

/** `{{source.name}}`, like the backend's placeholder pattern. */
const PLACEHOLDER = /\{\{\s*([A-Za-z_]+)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * The source a value's text names. A value from an earlier step wins, then an input AI writes,
 * then a plain input; a value whose only placeholders are secrets is an API secret; plain text
 * (or an unknown source) is fixed.
 */
export function valueSource(text: string, inputs: Pick<FlowInput, "name" | "generate">[]): ValueSource {
  const found = [...text.matchAll(PLACEHOLDER)].map((match) => ({ source: match[1], name: match[2] }));
  if (found.some((ref) => ref.source === "saved")) return "saved";
  const used = found.filter((ref) => ref.source === "input");
  if (used.some((ref) => inputs.some((input) => input.name === ref.name && input.generate))) return "generated";
  if (used.length > 0) return "input";
  if (found.some((ref) => ref.source === "secret")) return "secret";
  return "fixed";
}
