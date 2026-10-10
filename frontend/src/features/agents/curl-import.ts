import type { AgentFormValues } from "./form-schema";

/** The connection fields a cURL command can fill; name, context, protocol and Langfuse never. */
export type CurlImportedValues = Partial<Pick<AgentFormValues, "baseUrl" | "channelId" | "userId" | "origin">>;

export type CurlImportResult =
  | {
      ok: true;
      /** Only the fields found in the command. */
      values: CurlImportedValues;
      /** Query parameters left out on purpose (`threadId`, `voiceCapability`) or unknown. */
      ignored: string[];
      /** Fields the command did not provide or that could not be read; the user fills them. */
      warnings: string[];
    }
  | { ok: false; error: string };

const NO_URL = "No ws://, wss://, http:// or https:// URL found in the command.";
const URL_LIKE = /^(wss?|https?):\/\//i;
const AGENT_PATH = /^\/channelApi\/([^/]+)\/realtime$/;

// Flags whose value is the next argument, so a URL-looking value (a referer, a header) is never
// taken for the socket URL. `--url` is the one whose value is the URL.
const VALUE_FLAGS = new Set([
  "-X",
  "--request",
  "-H",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
  "-b",
  "--cookie",
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "-u",
  "--user",
  "-o",
  "--output",
  "--url",
]);
const SHORT_VALUE_FLAGS = new Set(Array.from(VALUE_FLAGS).filter((flag) => /^-[A-Za-z]$/.test(flag)));
const HEADER_FLAGS = new Set(["-H", "--header"]);

const ANSI_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" };

/**
 * Splits a POSIX shell command line into words: single quotes, double quotes, `$'…'`, backslash
 * escapes and `\` line continuations, which is what browsers' "Copy as cURL" produces.
 */
function tokenize(text: string): string[] {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let i = 0;
  const end = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };

  while (i < text.length) {
    const char = text[i];
    if (char === "\\" && (text[i + 1] === "\n" || (text[i + 1] === "\r" && text[i + 2] === "\n"))) {
      i += text[i + 1] === "\n" ? 2 : 3; // line continuation
      continue;
    }
    if (/\s/.test(char)) {
      end();
      i += 1;
      continue;
    }
    inWord = true;
    if (char === "'") {
      const close = text.indexOf("'", i + 1);
      word += text.slice(i + 1, close < 0 ? text.length : close);
      i = close < 0 ? text.length : close + 1;
    } else if (char === "$" && text[i + 1] === "'") {
      i += 2;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === "\\" && i + 1 < text.length) {
          word += ANSI_ESCAPES[text[i + 1]] ?? text[i + 1];
          i += 2;
        } else {
          word += text[i];
          i += 1;
        }
      }
      i += 1;
    } else if (char === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < text.length && '"\\$`\n'.includes(text[i + 1])) {
          if (text[i + 1] !== "\n") word += text[i + 1];
          i += 2;
        } else {
          word += text[i];
          i += 1;
        }
      }
      i += 1;
    } else if (char === "\\") {
      word += text[i + 1] ?? "";
      i += 2;
    } else {
      word += char;
      i += 1;
    }
  }
  end();
  return words;
}

/** The first URL-looking argument and every header, skipping the values of other flags. */
function readArguments(words: string[]): { url?: string; headers: string[] } {
  const headers: string[] = [];
  let url: string | undefined;
  const offer = (candidate: string) => {
    if (url === undefined && URL_LIKE.test(candidate)) url = candidate;
  };
  const take = (flag: string, value: string | undefined) => {
    if (value === undefined) return;
    if (HEADER_FLAGS.has(flag)) headers.push(value);
    else if (flag === "--url") offer(value);
  };

  const start = words[0]?.toLowerCase() === "curl" ? 1 : 0;
  for (let i = start; i < words.length; i += 1) {
    const word = words[i];
    if (word.startsWith("--") && word.includes("=")) {
      const separator = word.indexOf("=");
      take(word.slice(0, separator), word.slice(separator + 1));
    } else if (VALUE_FLAGS.has(word)) {
      take(word, words[i + 1]);
      i += 1;
    } else if (word.length > 2 && SHORT_VALUE_FLAGS.has(word.slice(0, 2))) {
      take(word.slice(0, 2), word.slice(2)); // attached value, like -H'Origin: …'
    } else if (!word.startsWith("-")) {
      offer(word);
    }
  }
  return { url, headers };
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function originFromHeaders(headers: string[], warnings: string[]): string | undefined {
  for (const header of headers) {
    const separator = header.indexOf(":");
    if (separator < 0 || header.slice(0, separator).trim().toLowerCase() !== "origin") continue;
    const value = header.slice(separator + 1).trim();
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // reported below
    }
    warnings.push(`The Origin header ${value} is not an http(s) origin; it was not used.`);
    return undefined;
  }
  return undefined;
}

/**
 * Reads an agent's connection fields from a cURL command copied from the browser's devtools,
 * like `curl 'wss://host/channelApi/{channelId}/realtime?userId=…' -H 'Origin: …'`.
 *
 * Pure string parsing; nothing is executed or fetched. It fails only when there is no usable
 * URL. Anything else that is missing (user ID) or unexpected (path shape) still fills what was
 * found and is reported in `warnings`. `threadId` (generated per run), `voiceCapability`
 * (added by the engine) and unknown query parameters are reported in `ignored`; headers other
 * than Origin are dropped silently.
 */
export function parseAgentCurl(text: string): CurlImportResult {
  if (!text.trim()) return { ok: false, error: "Paste a cURL command." };
  const { url: raw, headers } = readArguments(tokenize(text));
  if (raw === undefined) return { ok: false, error: NO_URL };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: `Could not read the URL ${raw}.` };
  }
  if (!url.hostname) return { ok: false, error: `Could not read the URL ${raw}.` };

  const values: CurlImportedValues = {};
  const ignored: string[] = [];
  const warnings: string[] = [];

  const scheme = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  values.baseUrl = `${scheme}//${url.host}`;

  const path = AGENT_PATH.exec(url.pathname);
  if (path) values.channelId = decode(path[1]);
  else {
    warnings.push(
      `The path ${url.pathname} is not /channelApi/{channelId}/realtime; enter the channel ID yourself.`,
    );
  }

  for (const [key, value] of url.searchParams) {
    if (key === "userId" && value) values.userId = value;
    else if (key !== "userId" && !ignored.includes(key)) ignored.push(key);
  }
  if (values.userId === undefined) warnings.push("No userId query parameter; enter the user ID yourself.");

  const origin = originFromHeaders(headers, warnings);
  if (origin !== undefined) values.origin = origin;

  return { ok: true, values, ignored, warnings };
}
