import type { Scenario } from "./types";

/** How many scenarios each agent has. */
export function countByAgent(scenarios: Scenario[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const scenario of scenarios) counts.set(scenario.agentId, (counts.get(scenario.agentId) ?? 0) + 1);
  return counts;
}
