import { apiFetch } from "@/lib/api";
import type { Agent, AgentChanges, NewAgent } from "./types";

const BASE = "/agents";
const item = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export function listAgents(signal?: AbortSignal): Promise<Agent[]> {
  return apiFetch<Agent[]>(BASE, { signal });
}

export function createAgent(input: NewAgent): Promise<Agent> {
  return apiFetch<Agent>(BASE, { method: "POST", body: input });
}

export function updateAgent(id: string, changes: AgentChanges): Promise<Agent> {
  return apiFetch<Agent>(item(id), { method: "PATCH", body: changes });
}

/** Refused with 409 `Agent is used by N scenario(s)` while scenarios reference it. */
export function deleteAgent(id: string): Promise<void> {
  return apiFetch<void>(item(id), { method: "DELETE" });
}
