import { ApiError } from "@/lib/api";
import type { FlowCheck, FlowInput, FlowRun, RunInputs, StepRun } from "./types";

/** The step a run opens on: its first failed step, otherwise the last one. */
export function defaultStepIndex(steps: Pick<StepRun, "status">[]): number {
  const failed = steps.findIndex((step) => step.status === "failed");
  return failed >= 0 ? failed : Math.max(0, steps.length - 1);
}

/** A run record's text cut at its `{{secret.<name>}}` placeholders. */
export type Segment = { text: string } | { secret: string };

const SECRET = /\{\{\s*secret\.(\w+)\s*\}\}/g;

export function secretSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let at = 0;
  for (const match of text.matchAll(SECRET)) {
    if (match.index > at) segments.push({ text: text.slice(at, match.index) });
    segments.push({ secret: match[1] });
    at = match.index + match[0].length;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}

/** A value as text: strings as they are, everything else as JSON. */
export function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

/** A request or response body: pretty JSON for an object or array, text otherwise, none when empty. */
export function prettyBody(body: unknown): { kind: "json" | "text"; text: string } | undefined {
  if (body === null || body === undefined || body === "") return undefined;
  if (typeof body === "object") return { kind: "json", text: JSON.stringify(body, null, 2) };
  const text = String(body);
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { kind: "json", text: JSON.stringify(JSON.parse(text), null, 2) };
    } catch {
      // A body cut short to be stored is still JSON to read, just not whole: indent what is there.
      if (text.includes("\n")) return { kind: "json", text };
      const cut = /… \[\d+ more characters\]$/.exec(text);
      const json = cut ? text.slice(0, cut.index) : text;
      return { kind: "json", text: reindentJson(json) + (cut ? `\n${cut[0]}` : "") };
    }
  }
  return { kind: "text", text };
}

/** Indents JSON text that may be cut short (so it cannot be parsed): a line per member, two
 * spaces per level, strings left as they are. */
export function reindentJson(text: string): string {
  let out = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  const newline = () => "\n" + "  ".repeat(Math.max(depth, 0));
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "{" || char === "[") {
      const close = char === "{" ? "}" : "]";
      let next = i + 1;
      while (text[next] === " ") next += 1;
      if (text[next] === close) {
        out += char + close;
        i = next;
      } else {
        depth += 1;
        out += char + newline();
      }
    } else if (char === "}" || char === "]") {
      depth -= 1;
      out += newline() + char;
    } else if (char === ",") {
      out += "," + newline();
      while (text[i + 1] === " ") i += 1;
    } else if (char === ":") {
      out += ": ";
      while (text[i + 1] === " ") i += 1;
    } else if (char !== "\n") {
      out += char;
    }
  }
  return out;
}

/** Where `query` occurs in `text`, ignoring case: start offsets in `text` itself. */
export function matchOffsets(text: string, query: string): number[] {
  if (!query) return [];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  // Lowercasing that changes lengths (like İ) would shift offsets: match the case as written.
  const [hay, find] = lower.length === text.length && needle.length === query.length ? [lower, needle] : [text, query];
  const offsets: number[] = [];
  for (let at = hay.indexOf(find); at !== -1; at = hay.indexOf(find, at + find.length)) offsets.push(at);
  return offsets;
}

export type JsonToken = { kind: "key" | "string" | "number" | "literal" | "plain"; text: string };

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|(?<![\w.])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])/g;

/** JSON text split into keys, strings, numbers and literals (true, false, null), so each can be
 * coloured. Works on JSON cut short too: whatever does not match stays plain. */
export function jsonTokens(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "plain", text: text.slice(last, index) });
    if (match[1] !== undefined) {
      tokens.push({ kind: match[2] ? "key" : "string", text: match[1] });
      if (match[2]) tokens.push({ kind: "plain", text: match[2] });
    } else {
      tokens.push({ kind: /^[-\d]/.test(match[0]) ? "number" : "literal", text: match[0] });
    }
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "plain", text: text.slice(last) });
  return tokens;
}

type NumberFormat = (value: number, options?: Intl.NumberFormatOptions) => string;

/** `840 ms` under a second, `2.4 s` above (in the locale's notation). */
export function formatDuration(ms: number, number: NumberFormat): string {
  if (ms < 1000) return `${number(Math.round(ms))} ms`;
  return `${number(ms / 1000, { maximumFractionDigits: 1 })} s`;
}

/** `512 B`, `1.2 KB`, `3.4 MB`. */
export function formatBytes(bytes: number, number: NumberFormat): string {
  if (bytes < 1024) return `${number(bytes)} B`;
  if (bytes < 1024 * 1024) return `${number(bytes / 1024, { maximumFractionDigits: 1 })} KB`;
  return `${number(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}

/** A check's rule as written in the flow's terms: `status == 200`, `body.items length > 0`, `durationMs < 500`. */
export function checkRule(check: FlowCheck): string {
  if (check.type === "status") return `status == ${check.equals}`;
  if (check.type === "duration") return `durationMs < ${check.maxMs}`;
  if (check.op === "exists") return `${check.path} exists`;
  return `${check.path} ${check.op} ${JSON.stringify(check.value)}`;
}

/** The path and query of a sent URL (the base URL is the API's); the URL as it is when it does not parse. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * The run form's values as the run's `inputs`: empty fields are left out (so the default applies,
 * or AI writes the value), numbers and booleans typed, anything else as typed.
 */
export function runInputsOf(inputs: Pick<FlowInput, "name" | "type">[], values: Record<string, string>): RunInputs {
  const out: RunInputs = {};
  for (const input of inputs) {
    const text = values[input.name] ?? "";
    const trimmed = text.trim();
    if (trimmed === "") continue;
    if (input.type === "number" && /^-?\d+(\.\d+)?$/.test(trimmed)) out[input.name] = Number(trimmed);
    else if (input.type === "boolean" && (trimmed === "true" || trimmed === "false")) out[input.name] = trimmed === "true";
    else out[input.name] = text;
  }
  return out;
}

/** The value each run form field starts with: the input's default, or empty. */
export const initialRunValues = (inputs: Pick<FlowInput, "name" | "default">[]): Record<string, string> =>
  Object.fromEntries(inputs.map((input) => [input.name, input.default ?? ""]));

/** How one flow of a Run all ended. */
export type RunAllOutcome =
  | { kind: "passed" | "failed"; run: FlowRun }
  | { kind: "needsInputs" | "aiUnavailable" | "error"; message: string };

export function runAllOutcome(result: { run: FlowRun } | { error: unknown }): RunAllOutcome {
  if ("run" in result) return { kind: result.run.status, run: result.run };
  const { error } = result;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ApiError && error.status === 422) return { kind: "needsInputs", message };
  if (error instanceof ApiError && error.status === 502) return { kind: "aiUnavailable", message };
  return { kind: "error", message };
}
