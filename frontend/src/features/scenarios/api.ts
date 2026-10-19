import { apiFetch } from "@/lib/api";
import type { GroupChanges, NewGroup, NewScenario, Scenario, ScenarioChanges, ScenarioGroup } from "./types";

const BASE = "/scenarios";
const item = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

/** Every scenario, most recently updated first (the library filters them in the browser). */
export function listScenarios(signal?: AbortSignal): Promise<Scenario[]> {
  return apiFetch<Scenario[]>(BASE, { signal });
}

export function getScenario(id: string, signal?: AbortSignal): Promise<Scenario> {
  return apiFetch<Scenario>(item(id), { signal });
}

export function createScenario(input: NewScenario): Promise<Scenario> {
  return apiFetch<Scenario>(BASE, { method: "POST", body: input });
}

export function updateScenario(id: string, changes: ScenarioChanges): Promise<Scenario> {
  return apiFetch<Scenario>(item(id), { method: "PATCH", body: changes });
}

export function deleteScenario(id: string): Promise<void> {
  return apiFetch<void>(item(id), { method: "DELETE" });
}

/** A copy under the same agent, named `<name> (copy)` (then `(copy 2)`, …). */
export function duplicateScenario(id: string): Promise<Scenario> {
  return apiFetch<Scenario>(`${item(id)}/duplicate`, { method: "POST" });
}

const GROUPS = "/scenario-groups";
const group = (id: string) => `${GROUPS}/${encodeURIComponent(id)}`;

/** Every group, alphabetically, with how many scenarios it holds and their agents. */
export function listGroups(signal?: AbortSignal): Promise<ScenarioGroup[]> {
  return apiFetch<ScenarioGroup[]>(GROUPS, { signal });
}

export function getGroup(id: string, signal?: AbortSignal): Promise<ScenarioGroup> {
  return apiFetch<ScenarioGroup>(group(id), { signal });
}

export function createGroup(input: NewGroup): Promise<ScenarioGroup> {
  return apiFetch<ScenarioGroup>(GROUPS, { method: "POST", body: input });
}

export function updateGroup(id: string, changes: GroupChanges): Promise<ScenarioGroup> {
  return apiFetch<ScenarioGroup>(group(id), { method: "PATCH", body: changes });
}

/** Refused (409) while the group holds scenarios. */
export function deleteGroup(id: string): Promise<void> {
  return apiFetch<void>(group(id), { method: "DELETE" });
}
