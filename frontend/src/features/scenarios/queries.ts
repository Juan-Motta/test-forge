"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createGroup,
  createScenario,
  deleteGroup,
  deleteScenario,
  duplicateScenario,
  getGroup,
  getScenario,
  listGroups,
  listScenarios,
  updateGroup,
  updateScenario,
} from "./api";
import type { GroupChanges, Scenario, ScenarioChanges, ScenarioGroup } from "./types";

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

/** Seeds the item cache with what the server returned and refreshes the lists (groups count scenarios). */
function stored(queryClient: QueryClient, scenario: Scenario) {
  queryClient.setQueryData(scenarioQueryKey(scenario.id), scenario);
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: listKey }),
    queryClient.invalidateQueries({ queryKey: groupsQueryKey }),
  ]);
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
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: listKey }),
        queryClient.invalidateQueries({ queryKey: groupsQueryKey }),
      ]);
    },
  });
}

export const groupsQueryKey = ["scenario-groups"] as const;
const groupsListKey = [...groupsQueryKey, "list"] as const;
export const groupQueryKey = (id: string) => [...groupsQueryKey, "item", id] as const;

export function useGroups() {
  return useQuery({ queryKey: groupsListKey, queryFn: ({ signal }) => listGroups(signal) });
}

export function useGroup(id: string | undefined) {
  return useQuery({
    queryKey: groupQueryKey(id ?? ""),
    queryFn: ({ signal }) => getGroup(id ?? "", signal),
    enabled: id !== undefined,
  });
}

/** Seeds the group's cache and refreshes the groups and the scenarios (they show the group's name). */
function storedGroup(queryClient: QueryClient, group: ScenarioGroup) {
  queryClient.setQueryData(groupQueryKey(group.id), group);
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: groupsListKey }),
    queryClient.invalidateQueries({ queryKey: scenariosQueryKey }),
  ]);
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: createGroup, onSuccess: (group) => storedGroup(queryClient, group) });
}

export function useUpdateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: GroupChanges }) => updateGroup(id, changes),
    onSuccess: (group) => storedGroup(queryClient, group),
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (group: ScenarioGroup) => deleteGroup(group.id),
    onSuccess: (_, group) => {
      queryClient.removeQueries({ queryKey: groupQueryKey(group.id) });
      return queryClient.invalidateQueries({ queryKey: groupsListKey });
    },
  });
}
