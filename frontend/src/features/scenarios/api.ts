import { apiFetch } from "@/lib/api";
import type { NewScenario, Scenario, ScenarioChanges } from "./types";

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
