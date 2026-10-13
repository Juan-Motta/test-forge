/** Wire protocols the backend accepts (`AgentProtocol`). */
export const AGENT_PROTOCOLS = ["auto", "live", "realtime"] as const;
export type AgentProtocol = (typeof AGENT_PROTOCOLS)[number];

/** `voice`: a realtime WebSocket agent. `text`: a chat agent behind Vivi's channel API. Fixed at creation. */
export const AGENT_KINDS = ["voice", "text"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** How a text agent is called: `stream` (`/stream`, the reply as it is written) or `invoke` (the whole reply). */
export const TEXT_MODES = ["stream", "invoke"] as const;
export type TextMode = (typeof TEXT_MODES)[number];

/** `none`: a WEB channel (like the portal's testing channel). `api_key`: an API channel (`vivi-api-key`). */
export const TEXT_AUTHS = ["none", "api_key"] as const;
export type TextAuth = (typeof TEXT_AUTHS)[number];

/** An agent under test, as `GET /api/agents` returns it. */
export type Agent = {
  id: string;
  name: string;
  kind: AgentKind;
  /** What the agent does; shared by all its scenarios. */
  context: string;
  /** Voice agents; text agents report `auto`. */
  protocol: AgentProtocol;
  baseUrl: string;
  channelId: string;
  /** Voice agents only (`null` for text agents). */
  userId: string | null;
  /** Text agents only. */
  textMode: TextMode | null;
  auth: TextAuth | null;
  /** The key itself is write-only: only whether one is stored and its masked tail. */
  hasApiKey: boolean;
  apiKeyHint: string | null;
  origin: string | null;
  langfuseConnectionId: string | null;
  createdAt: string;
  updatedAt: string;
};

type AgentCommon = {
  name: string;
  context: string;
  baseUrl: string;
  channelId: string;
  origin: string | null;
  langfuseConnectionId: string | null;
};

export type NewVoiceAgent = AgentCommon & { kind: "voice"; protocol: AgentProtocol; userId: string };
export type NewTextAgent = AgentCommon & {
  kind: "text";
  textMode: TextMode;
  auth: TextAuth;
  /** Write-only; sent only with `auth: api_key`. */
  apiKey?: string;
};
export type NewAgent = NewVoiceAgent | NewTextAgent;

/**
 * Omitted fields are kept; `null` clears `origin` or `langfuseConnectionId`. `kind` never changes;
 * `apiKey` replaces the stored key and `auth: none` removes it.
 */
export type AgentChanges = Partial<Omit<NewVoiceAgent, "kind"> & Omit<NewTextAgent, "kind">>;

/** One step of a connection check, in order. */
export type ConnectionLogLine = { ok: boolean; message: string };

/**
 * `POST /api/agents/{id}/test`. Voice: the agent's socket was opened and closed once its session
 * was ready (no audio sent). Text: one short message was sent and answered. An unreachable agent
 * is a 200 with `reachable: false`.
 */
export type AgentConnectionTest = {
  reachable: boolean;
  /** Voice: connect plus ready; text: the whole reply; when reachable. */
  latencyMs: number | null;
  /** `live` or `realtime`, once detected; always null for text agents. */
  protocol: string | null;
  log: ConnectionLogLine[];
};
