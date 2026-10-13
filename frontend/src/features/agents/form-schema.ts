import { z } from "zod";
import {
  AGENT_KINDS,
  AGENT_PROTOCOLS,
  TEXT_AUTHS,
  TEXT_MODES,
  type Agent,
  type AgentChanges,
  type AgentKind,
  type AgentProtocol,
  type NewAgent,
  type TextAuth,
  type TextMode,
} from "./types";

/**
 * Form state for both kinds; only the fields of the chosen kind are validated and sent. Field
 * names match the API's error locations (`baseUrl`, `apiKey`), so server field errors land on the
 * inputs without translation. Optional values are "" here; `apiKey` is "" unless a new key is typed.
 */
export type AgentFormValues = {
  kind: AgentKind;
  name: string;
  context: string;
  protocol: AgentProtocol;
  baseUrl: string;
  channelId: string;
  userId: string;
  textMode: TextMode;
  auth: TextAuth;
  apiKey: string;
  origin: string;
  langfuseConnectionId: string;
};

/** The form's fields in display order (used to focus the first one with an error). */
export const AGENT_FIELDS = [
  "kind",
  "name",
  "context",
  "protocol",
  "baseUrl",
  "channelId",
  "userId",
  "textMode",
  "auth",
  "apiKey",
  "origin",
  "langfuseConnectionId",
] as const satisfies readonly (keyof AgentFormValues)[];

export const KIND_LABELS: Record<AgentKind, { label: string; description: string }> = {
  voice: { label: "Voice", description: "Talks over a realtime WebSocket; the evaluator calls it." },
  text: { label: "Text", description: "Chats over Vivi's channel API; the evaluator writes to it." },
};

export const TEXT_MODE_LABELS: Record<TextMode, { label: string; description: string }> = {
  stream: { label: "Stream", description: "The reply arrives as it is written; latency is the time to the first text." },
  invoke: { label: "Invoke", description: "The whole reply in one response; latency is the time to the full reply." },
};

export const TEXT_AUTH_LABELS: Record<TextAuth, { label: string; description: string }> = {
  none: { label: "None", description: "A WEB channel, like the portal's testing channel: no credentials." },
  api_key: { label: "API key", description: "An API channel: the key is sent as the vivi-api-key header." },
};

export const PROTOCOL_LABELS: Record<AgentProtocol, string> = {
  auto: "Auto-detect",
  live: "Live",
  realtime: "Realtime",
};

// Limits and patterns mirror the backend's agents domain (agents/domain.py).
const MAX_NAME = 120;
const MAX_CONTEXT = 20000;
const MAX_URL = 2048;
const MAX_CHANNEL_ID = 200;
const MAX_USER_ID = 200;
const MAX_ORIGIN = 300;
const MAX_API_KEY = 512;
const CHANNEL_ID = /^[A-Za-z0-9._~-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Hosts a `ws://` URL may name: an agent running on this machine (the backend may run in Docker). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal"]);

function hasUnsafeCharacter(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return /\s/.test(char) || char === "\\" || code < 0x20 || code === 0x7f;
  });
}

/** Shared URL shape checks, in the backend's order (`_split`); returns the parsed URL or a problem. */
function parseUrl(value: string): URL | string {
  if (hasUnsafeCharacter(value)) return "URL must not contain spaces, backslashes or control characters.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "URL must be absolute and name a host.";
  }
  if (!url.hostname) return "URL must be absolute and name a host.";
  const authority = value.split("//")[1]?.split("/")[0] ?? "";
  if (url.username || url.password || authority.includes("@")) return "URL must not contain credentials.";
  if (url.search || url.hash || value.endsWith("?") || value.endsWith("#")) {
    return "URL must not contain a query string or fragment.";
  }
  return url;
}

/**
 * The agent's base URL. Voice: the WebSocket URL, `wss://`. Text: the channel API's host,
 * `https://`. The plain scheme (`ws://`, `http://`) works for a local agent (`localhost`,
 * `127.0.0.1`, `host.docker.internal`), which the server accepts in any environment.
 */
export function baseUrlProblem(value: string, kind: AgentKind = "voice"): string | undefined {
  if (value.length > MAX_URL) return "URL is too long.";
  const url = parseUrl(value);
  if (typeof url === "string") return url;
  const [secure, plain] = kind === "text" ? ["https:", "http:"] : ["wss:", "ws:"];
  const local = url.protocol === plain && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== secure && !local) return `URL must use ${secure}//.`;
  return undefined;
}

/** An HTTP(S) origin: scheme, host and optional port only. */
export function originProblem(value: string): string | undefined {
  if (value.length > MAX_ORIGIN) return `Use at most ${MAX_ORIGIN} characters.`;
  const url = parseUrl(value);
  if (typeof url === "string") return url.replace(/^URL/, "Origin");
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Origin must use https or http.";
  if (url.pathname !== "/") return "Origin must be only scheme, host and port.";
  return undefined;
}

const PRINTABLE = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;

/**
 * Validates the fields of the chosen kind only. `hasStoredKey`: the agent already has an API key,
 * so `auth: api_key` needs no new one.
 */
export function agentFormSchema(hasStoredKey = false) {
  return z
    .object({
      kind: z.enum(AGENT_KINDS),
      name: z.string().trim().min(1, "Enter a name.").max(MAX_NAME, `Use at most ${MAX_NAME} characters.`),
      context: z.string().trim().max(MAX_CONTEXT, `Use at most ${MAX_CONTEXT} characters.`),
      protocol: z.enum(AGENT_PROTOCOLS),
      baseUrl: z.string().trim(),
      channelId: z.string().trim(),
      userId: z.string().trim(),
      textMode: z.enum(TEXT_MODES),
      auth: z.enum(TEXT_AUTHS),
      apiKey: z.string().trim().max(MAX_API_KEY, `Use at most ${MAX_API_KEY} characters.`),
      origin: z.string().trim(),
      langfuseConnectionId: z.string(),
    })
    .superRefine((values, ctx) => {
      const issue = (path: keyof AgentFormValues, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      const text = values.kind === "text";
      if (!values.baseUrl) issue("baseUrl", text ? "Enter the agent's base URL." : "Enter the agent's WebSocket URL.");
      else {
        const url = baseUrlProblem(values.baseUrl, values.kind);
        if (url) issue("baseUrl", url);
      }
      if (!values.channelId) issue("channelId", "Enter the channel ID.");
      else if (values.channelId.length > MAX_CHANNEL_ID) issue("channelId", `Use at most ${MAX_CHANNEL_ID} characters.`);
      else if (text && !UUID.test(values.channelId)) issue("channelId", "Use the channel's UUID.");
      else if (!CHANNEL_ID.test(values.channelId)) issue("channelId", "Use only letters, digits and . _ ~ - (no spaces).");
      if (!text) {
        if (!values.userId) issue("userId", "Enter the user ID.");
        else if (values.userId.length > MAX_USER_ID) issue("userId", `Use at most ${MAX_USER_ID} characters.`);
        else if (!PRINTABLE.test(values.userId)) issue("userId", "Use only printable characters.");
      } else if (values.auth === "api_key" && !values.apiKey && !hasStoredKey) {
        issue("apiKey", "Enter the API key.");
      }
      const origin = values.origin ? originProblem(values.origin) : undefined;
      if (origin) issue("origin", origin);
    });
}

export function initialValues(agent?: Agent): AgentFormValues {
  return {
    kind: agent?.kind ?? "voice",
    name: agent?.name ?? "",
    context: agent?.context ?? "",
    protocol: agent?.protocol ?? "auto",
    baseUrl: agent?.baseUrl ?? "",
    channelId: agent?.channelId ?? "",
    userId: agent?.userId ?? "",
    textMode: agent?.textMode ?? "stream",
    auth: agent?.auth ?? "none",
    apiKey: "",
    origin: agent?.origin ?? "",
    langfuseConnectionId: agent?.langfuseConnectionId ?? "",
  };
}

/** The create payload: the fields of the chosen kind only; the API key only with `auth: api_key`. */
export function toNewAgent(values: AgentFormValues): NewAgent {
  const common = {
    name: values.name.trim(),
    context: values.context.trim(),
    baseUrl: values.baseUrl.trim(),
    channelId: values.channelId.trim(),
    origin: values.origin.trim() || null,
    langfuseConnectionId: values.langfuseConnectionId || null,
  };
  if (values.kind === "voice") {
    return { ...common, kind: "voice", protocol: values.protocol, userId: values.userId.trim() };
  }
  const apiKey = values.auth === "api_key" ? values.apiKey.trim() : "";
  return { ...common, kind: "text", textMode: values.textMode, auth: values.auth, ...(apiKey ? { apiKey } : {}) };
}

/**
 * Only the fields that differ from the stored agent; a cleared optional field becomes `null`.
 * `kind` is never sent, and a typed API key always is (it replaces the stored one).
 */
export function toChanges(agent: Agent, values: AgentFormValues): AgentChanges {
  const { kind, ...next } = toNewAgent({ ...values, kind: agent.kind });
  void kind;
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (key === "apiKey" || value !== agent[key as keyof Agent]) changes[key] = value;
  }
  return changes as AgentChanges;
}
