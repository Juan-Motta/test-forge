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
