import { z } from "zod";
import { AGENT_PROTOCOLS, type Agent, type AgentChanges, type AgentProtocol, type NewAgent } from "./types";

/**
 * Form state. Field names match the API's error locations (`baseUrl`, `langfuseConnectionId`),
 * so server field errors land on the inputs without translation. Optional values are "" here.
 */
export type AgentFormValues = {
  name: string;
  context: string;
  protocol: AgentProtocol;
  baseUrl: string;
  channelId: string;
  userId: string;
  origin: string;
  langfuseConnectionId: string;
};

/** The form's fields in display order (used to focus the first one with an error). */
export const AGENT_FIELDS = [
  "name",
  "context",
  "protocol",
  "baseUrl",
  "channelId",
  "userId",
  "origin",
  "langfuseConnectionId",
] as const satisfies readonly (keyof AgentFormValues)[];

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
const CHANNEL_ID = /^[A-Za-z0-9._~-]+$/;
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
 * The agent's WebSocket URL: `wss://`, or `ws://` for a local agent (`localhost`, `127.0.0.1`,
 * `host.docker.internal`), which the server accepts in any environment.
 */
export function baseUrlProblem(value: string): string | undefined {
  if (value.length > MAX_URL) return "URL is too long.";
  const url = parseUrl(value);
  if (typeof url === "string") return url;
  const localWs = url.protocol === "ws:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "wss:" && !localWs) return "URL must use wss://.";
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

export const agentFormSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name.").max(MAX_NAME, `Use at most ${MAX_NAME} characters.`),
    context: z.string().trim().max(MAX_CONTEXT, `Use at most ${MAX_CONTEXT} characters.`),
    protocol: z.enum(AGENT_PROTOCOLS),
    baseUrl: z.string().trim().min(1, "Enter the agent's WebSocket URL."),
    channelId: z
      .string()
      .trim()
      .min(1, "Enter the channel ID.")
      .max(MAX_CHANNEL_ID, `Use at most ${MAX_CHANNEL_ID} characters.`)
      .regex(CHANNEL_ID, "Use only letters, digits and . _ ~ - (no spaces)."),
    userId: z
      .string()
      .trim()
      .min(1, "Enter the user ID.")
      .max(MAX_USER_ID, `Use at most ${MAX_USER_ID} characters.`)
      .regex(PRINTABLE, "Use only printable characters."),
    origin: z.string().trim(),
    langfuseConnectionId: z.string(),
  })
  .superRefine((values, ctx) => {
    const url = values.baseUrl ? baseUrlProblem(values.baseUrl) : undefined;
    if (url) ctx.addIssue({ code: "custom", path: ["baseUrl"], message: url });
    const origin = values.origin ? originProblem(values.origin) : undefined;
    if (origin) ctx.addIssue({ code: "custom", path: ["origin"], message: origin });
  });

export function initialValues(agent?: Agent): AgentFormValues {
  return {
    name: agent?.name ?? "",
    context: agent?.context ?? "",
    protocol: agent?.protocol ?? "auto",
    baseUrl: agent?.baseUrl ?? "",
    channelId: agent?.channelId ?? "",
    userId: agent?.userId ?? "",
    origin: agent?.origin ?? "",
    langfuseConnectionId: agent?.langfuseConnectionId ?? "",
  };
}

export function toNewAgent(values: AgentFormValues): NewAgent {
  return {
    name: values.name.trim(),
    context: values.context.trim(),
    protocol: values.protocol,
    baseUrl: values.baseUrl.trim(),
    channelId: values.channelId.trim(),
    userId: values.userId.trim(),
    origin: values.origin.trim() || null,
    langfuseConnectionId: values.langfuseConnectionId || null,
  };
}

/** Only the fields that differ from the stored agent; a cleared optional field becomes `null`. */
export function toChanges(agent: Agent, values: AgentFormValues): AgentChanges {
  const next = toNewAgent(values);
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof NewAgent)[]) {
    if (next[key] !== agent[key]) changes[key] = next[key];
  }
  return changes as AgentChanges;
}
