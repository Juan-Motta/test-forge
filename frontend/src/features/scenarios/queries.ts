"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createScenario, deleteScenario, duplicateScenario, getScenario, listScenarios, updateScenario } from "./api";
import type { Scenario, ScenarioChanges } from "./types";

export const scenariosQueryKey = ["scenarios"] as const;
const listKey = [...scenariosQueryKey, "list"] as const;
export const scenarioQueryKey = (id: string) => [...scenariosQueryKey, "item", id] as const;

export function useScenarios() {
  return useQuery({ queryKey: listKey, queryFn: ({ signal }) => listScenarios(signal) });
}

export function useScenario(id: string | undefined) {
  return useQuery({
    queryKey: scenarioQueryKey(id ?? ""),
    queryFn: ({ signal }) => getScenario(id ?? "", signal),
    enabled: id !== undefined,
  });
}

/** Seeds the item cache with what the server returned and refreshes the list. */
function stored(queryClient: QueryClient, scenario: Scenario) {
  queryClient.setQueryData(scenarioQueryKey(scenario.id), scenario);
  return queryClient.invalidateQueries({ queryKey: listKey });
}

export function useCreateScenario() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: createScenario, onSuccess: (scenario) => stored(queryClient, scenario) });
}

export function useUpdateScenario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: ScenarioChanges }) => updateScenario(id, changes),
    onSuccess: (scenario) => stored(queryClient, scenario),
  });
}

export function useDuplicateScenario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scenario: Scenario) => duplicateScenario(scenario.id),
    onSuccess: (copy) => stored(queryClient, copy),
  });
}

export function useDeleteScenario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scenario: Scenario) => deleteScenario(scenario.id),
    onSuccess: (_, scenario) => {
      queryClient.setQueryData<Scenario[]>(listKey, (list) => list?.filter((item) => item.id !== scenario.id));
      queryClient.removeQueries({ queryKey: scenarioQueryKey(scenario.id) });
      return queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}
