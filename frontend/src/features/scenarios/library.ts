import type { Agent } from "@/features/agents/types";
import type { ScenarioGroup } from "./ScenarioList";
import type { Scenario } from "./types";

export type LibraryFilters = { agentId: string; tag: string | null };

/** Every tag in use, alphabetically. */
export function allTags(scenarios: Scenario[]): string[] {
  return [...new Set(scenarios.flatMap((scenario) => scenario.tags))].sort((a, b) => a.localeCompare(b));
}

/**
 * The scenarios matching the filters, grouped by agent in the agents' (name) order; within a
 * group they keep the API order (most recently updated first).
 */
export function groupScenarios(scenarios: Scenario[], agents: Agent[], filters: LibraryFilters): ScenarioGroup[] {
  const matching = scenarios.filter(
    (scenario) =>
      (!filters.agentId || scenario.agentId === filters.agentId) &&
      (filters.tag === null || scenario.tags.includes(filters.tag)),
  );
  const groups = new Map<string, ScenarioGroup>();
  for (const scenario of matching) {
    const group = groups.get(scenario.agentId) ?? {
      agentId: scenario.agentId,
      agentName: scenario.agent.name,
      scenarios: [],
    };
    group.scenarios.push(scenario);
    groups.set(scenario.agentId, group);
  }
  const order = new Map(agents.map((agent, index) => [agent.id, index]));
  return [...groups.values()].sort(
    (a, b) =>
      (order.get(a.agentId) ?? Infinity) - (order.get(b.agentId) ?? Infinity) || a.agentName.localeCompare(b.agentName),
  );
}

/** How many scenarios each agent has. */
export function countByAgent(scenarios: Scenario[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const scenario of scenarios) counts.set(scenario.agentId, (counts.get(scenario.agentId) ?? 0) + 1);
  return counts;
}
