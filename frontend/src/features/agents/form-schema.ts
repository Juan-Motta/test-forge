import { z } from "zod";
import type { Translator } from "@/lib/i18n";
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
  sessionUrl: string;
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
  "sessionUrl",
  "textMode",
  "auth",
  "apiKey",
  "origin",
  "langfuseConnectionId",
] as const satisfies readonly (keyof AgentFormValues)[];

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

type UrlProblem = "unsafe" | "absolute" | "credentials" | "query";

/** Shared URL shape checks, in the backend's order (`_split`); returns the parsed URL or a problem. */
function parseUrl(value: string): URL | UrlProblem {
  if (hasUnsafeCharacter(value)) return "unsafe";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "absolute";
  }
  if (!url.hostname) return "absolute";
  const authority = value.split("//")[1]?.split("/")[0] ?? "";
  if (url.username || url.password || authority.includes("@")) return "credentials";
  if (url.search || url.hash || value.endsWith("?") || value.endsWith("#")) return "query";
  return url;
}

/**
 * The agent's base URL. Voice: the WebSocket URL, `wss://`. Text: the channel API's host,
 * `https://`. The plain scheme (`ws://`, `http://`) works for a local agent (`localhost`,
 * `127.0.0.1`, `host.docker.internal`), which the server accepts in any environment.
 */
export function baseUrlProblem(t: Translator, value: string, kind: AgentKind = "voice"): string | undefined {
  if (value.length > MAX_URL) return t("agents.url.tooLong");
  const url = parseUrl(value);
  if (typeof url === "string") return t(`agents.url.${url}`);
  const [secure, plain] = kind === "text" ? ["https:", "http:"] : ["wss:", "ws:"];
  const local = url.protocol === plain && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== secure && !local) return t("agents.url.scheme", { scheme: `${secure}//` });
  return undefined;
}

/** A relay agent's session URL: `https://` (or `http://` to a local host) on the WebSocket URL's host. */
export function sessionUrlProblem(t: Translator, value: string, baseUrl: string): string | undefined {
  if (value.length > MAX_URL) return t("agents.url.tooLong");
  const url = parseUrl(value);
  if (typeof url === "string") return t(`agents.url.${url}`);
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) return t("agents.url.scheme", { scheme: "https://" });
  const base = parseUrl(baseUrl);
  if (typeof base !== "string" && base.hostname !== url.hostname) return t("agents.error.sessionUrlHost");
  return undefined;
}

/** An HTTP(S) origin: scheme, host and optional port only. */
export function originProblem(t: Translator, value: string): string | undefined {
  if (value.length > MAX_ORIGIN) return t("common.maxChars", { max: MAX_ORIGIN });
  const url = parseUrl(value);
  if (typeof url === "string") return t(`agents.origin.${url}`);
  if (url.protocol !== "https:" && url.protocol !== "http:") return t("agents.origin.scheme");
  if (url.pathname !== "/") return t("agents.origin.path");
  return undefined;
}

const PRINTABLE = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;

/**
 * Validates the fields of the chosen kind only. `hasStoredKey`: the agent already has an API key,
 * so `auth: api_key` needs no new one.
 */
export function agentFormSchema(t: Translator, hasStoredKey = false) {
  return z
    .object({
      kind: z.enum(AGENT_KINDS),
      name: z
        .string()
        .trim()
        .min(1, t("scenarios.error.name"))
        .max(MAX_NAME, t("common.maxChars", { max: MAX_NAME })),
      context: z.string().trim().max(MAX_CONTEXT, t("common.maxChars", { max: MAX_CONTEXT })),
      protocol: z.enum(AGENT_PROTOCOLS),
      baseUrl: z.string().trim(),
      channelId: z.string().trim(),
      userId: z.string().trim(),
      sessionUrl: z.string().trim(),
      textMode: z.enum(TEXT_MODES),
      auth: z.enum(TEXT_AUTHS),
      apiKey: z.string().trim().max(MAX_API_KEY, t("common.maxChars", { max: MAX_API_KEY })),
      origin: z.string().trim(),
      langfuseConnectionId: z.string(),
    })
    .superRefine((values, ctx) => {
      const issue = (path: keyof AgentFormValues, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      const text = values.kind === "text";
      if (!values.baseUrl) issue("baseUrl", text ? t("agents.error.baseUrl") : t("agents.error.wsUrl"));
      else {
        const url = baseUrlProblem(t, values.baseUrl, values.kind);
        if (url) issue("baseUrl", url);
      }
      // A relay agent has no channel or user: only the Vivi protocols address them.
      const relay = !text && values.protocol === "relay";
      if (relay) {
        const session = values.sessionUrl ? sessionUrlProblem(t, values.sessionUrl, values.baseUrl) : undefined;
        if (session) issue("sessionUrl", session);
      } else if (!values.channelId) issue("channelId", t("agents.error.channelId"));
      else if (values.channelId.length > MAX_CHANNEL_ID) issue("channelId", t("common.maxChars", { max: MAX_CHANNEL_ID }));
      else if (text && !UUID.test(values.channelId)) issue("channelId", t("agents.error.channelUuid"));
      else if (!CHANNEL_ID.test(values.channelId)) issue("channelId", t("agents.error.channelChars"));
      if (relay) {
        // Nothing more: the session URL is checked above.
      } else if (!text) {
        if (!values.userId) issue("userId", t("agents.error.userId"));
        else if (values.userId.length > MAX_USER_ID) issue("userId", t("common.maxChars", { max: MAX_USER_ID }));
        else if (!PRINTABLE.test(values.userId)) issue("userId", t("agents.error.printable"));
      } else if (values.auth === "api_key" && !values.apiKey && !hasStoredKey) {
        issue("apiKey", t("agents.error.apiKey"));
      }
      const origin = values.origin ? originProblem(t, values.origin) : undefined;
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
    sessionUrl: agent?.sessionUrl ?? "",
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
  if (values.kind === "voice" && values.protocol === "relay") {
    const { channelId, ...rest } = common;
    void channelId;
    return { ...rest, kind: "voice", protocol: "relay", userId: null, sessionUrl: values.sessionUrl.trim() || null };
  }
  if (values.kind === "voice") {
    return { ...common, kind: "voice", protocol: values.protocol, userId: values.userId.trim(), sessionUrl: null };
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
