"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAgent, deleteAgent, listAgents, updateAgent } from "./api";
import type { Agent, AgentChanges } from "./types";

export const agentsQueryKey = ["agents"] as const;

export function useAgents() {
  return useQuery({ queryKey: agentsQueryKey, queryFn: ({ signal }) => listAgents(signal) });
}

function useInvalidateAgents() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: agentsQueryKey });
}

export function useCreateAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({ mutationFn: createAgent, onSuccess: invalidate });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: AgentChanges }) => updateAgent(id, changes),
    // Scenarios embed their agent's name (`["scenarios", …]` queries): refresh them after a rename.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: agentsQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["scenarios"] }),
      ]),
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agent: Agent) => deleteAgent(agent.id),
    onSuccess: (_, agent) => {
      queryClient.setQueryData<Agent[]>(agentsQueryKey, (list) => list?.filter((item) => item.id !== agent.id));
      return queryClient.invalidateQueries({ queryKey: agentsQueryKey });
    },
  });
}
