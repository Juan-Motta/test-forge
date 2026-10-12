/** Wire protocols the backend accepts (`AgentProtocol`). */
export const AGENT_PROTOCOLS = ["auto", "live", "realtime"] as const;
export type AgentProtocol = (typeof AGENT_PROTOCOLS)[number];

/** A voice agent under test, as `GET /api/agents` returns it. */
export type Agent = {
  id: string;
  name: string;
  /** What the agent does; shared by all its scenarios. */
  context: string;
  protocol: AgentProtocol;
  baseUrl: string;
  channelId: string;
  userId: string;
  origin: string | null;
  langfuseConnectionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewAgent = {
  name: string;
  context: string;
  protocol: AgentProtocol;
  baseUrl: string;
  channelId: string;
  userId: string;
  origin: string | null;
  langfuseConnectionId: string | null;
};

/** Omitted fields are kept; `null` clears `origin` or `langfuseConnectionId`. */
export type AgentChanges = Partial<NewAgent>;

/** One step of a connection check, in order. */
export type ConnectionLogLine = { ok: boolean; message: string };

/**
 * `POST /api/agents/{id}/test`: the agent's socket was opened and closed once its session was
 * ready (no audio sent). An unreachable agent is a 200 with `reachable: false`.
 */
export type AgentConnectionTest = {
  reachable: boolean;
  /** Connect plus ready, when reachable. */
  latencyMs: number | null;
  /** `live` or `realtime`, once detected. */
  protocol: string | null;
  log: ConnectionLogLine[];
};
