import type { Agent } from "@/features/agents/types";
import type { ScenarioGroup } from "./ScenarioList";
import type { Scenario } from "./types";

/** `tag` applies only with an agent picked (its tags are the ones offered); `search` matches names and tags. */
export type LibraryFilters = { agentId: string; tag: string | null; search: string };

/** Whether a scenario's name or one of its tags contains the search (case-insensitive). */
function matchesSearch(scenario: Scenario, search: string): boolean {
  const wanted = search.trim().toLowerCase();
  if (!wanted) return true;
  return scenario.name.toLowerCase().includes(wanted) || scenario.tags.some((tag) => tag.toLowerCase().includes(wanted));
}

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
      (filters.tag === null || scenario.tags.includes(filters.tag)) &&
      matchesSearch(scenario, filters.search),
  );
  const groups = new Map<string, ScenarioGroup>();
  const kinds = new Map(agents.map((agent) => [agent.id, agent.kind]));
  for (const scenario of matching) {
    const group = groups.get(scenario.agentId) ?? {
      agentId: scenario.agentId,
      agentName: scenario.agent.name,
      agentKind: kinds.get(scenario.agentId),
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
