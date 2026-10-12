"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { createAgent, deleteAgent, listAgents, testAgentConnection, updateAgent } from "./api";
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
    mutationFn: async (agent: Agent) => {
      try {
        await deleteAgent(agent.id);
      } catch (error) {
        // Already gone (another tab, or a retried request): the outcome the user asked for.
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    },
    onSuccess: (_, agent) => {
      queryClient.setQueryData<Agent[]>(agentsQueryKey, (list) => list?.filter((item) => item.id !== agent.id));
      return queryClient.invalidateQueries({ queryKey: agentsQueryKey });
    },
  });
}

/** Dials the agent once (no audio); the result is kept by the caller, per agent, for the session. */
export function useTestAgentConnection() {
  return useMutation({ mutationFn: (agent: Agent) => testAgentConnection(agent.id) });
}
