"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listAgents } from "@/features/agents/api";
import { agentsQueryKey } from "@/features/agents/queries";
import { listConnections } from "@/features/connections/api";
import { connectionsQueryKey } from "@/features/connections/queries";
import { isJudging } from "@/features/judgements/format";
import {
  LEVEL_BINS,
  cancelBatch,
  cancelRun,
  getBatch,
  getRun,
  getRunLevels,
  getRunTrace,
  launchRuns,
  listBatches,
  listRuns,
  rerunRun,
} from "./api";
import { isActive } from "./format";
import type { RunFilters } from "./types";

export const runsQueryKey = ["runs"] as const;
const listKey = (filters: RunFilters) => [...runsQueryKey, "list", filters] as const;
export const runQueryKey = (id: string) => [...runsQueryKey, "item", id] as const;
const batchesKey = (page: { limit?: number; offset?: number }) => [...runsQueryKey, "batches", page] as const;
const batchKey = (id: string) => [...runsQueryKey, "batch", id] as const;
const levelsKey = (id: string, bins: number) => [...runsQueryKey, "levels", id, bins] as const;
// Under `runsQueryKey`: a finished judgement refreshes every runs query, and so the trace it saved.
const traceKey = (id: string) => [...runsQueryKey, "trace", id] as const;

type Polling = { refetchInterval?: number | false };

/** `pollActiveMs`: refetch at this interval while the page shows an active run or judgement. */
export function useRuns(filters: RunFilters, options: { pollActiveMs?: number; refetchInterval?: number } = {}) {
  const { pollActiveMs, refetchInterval } = options;
  return useQuery({
    queryKey: listKey(filters),
    queryFn: ({ signal }) => listRuns(filters, signal),
    refetchInterval: (query) =>
      refetchInterval ??
      (pollActiveMs && query.state.data?.items.some((run) => isActive(run.status) || isJudging(run.judgementStatus))
        ? pollActiveMs
        : false),
    placeholderData: (previous) => previous,
  });
}

/** `pollWhileActiveMs`: refetch at this interval until the run reaches a terminal status. */
export function useRun(id: string, options: { pollWhileActiveMs?: number } = {}) {
  const { pollWhileActiveMs } = options;
  return useQuery({
    queryKey: runQueryKey(id),
    queryFn: ({ signal }) => getRun(id, signal),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return pollWhileActiveMs && status && isActive(status) ? pollWhileActiveMs : false;
    },
  });
}

export function useBatches(page: { limit?: number; offset?: number } = {}, options: Polling = {}) {
  return useQuery({
    queryKey: batchesKey(page),
    queryFn: ({ signal }) => listBatches(page, signal),
    refetchInterval: options.refetchInterval,
  });
}

export function useBatch(id: string | undefined, options: Polling = {}) {
  return useQuery({
    queryKey: batchKey(id ?? ""),
    queryFn: ({ signal }) => getBatch(id ?? "", signal),
    enabled: id !== undefined,
    refetchInterval: options.refetchInterval,
  });
}

/** Every runs query is stale after a launch or a cancel. */
function refreshRuns(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ queryKey: runsQueryKey });
}

export function useLaunchRuns() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: launchRuns, onSuccess: () => refreshRuns(queryClient) });
}

export function useCancelRun() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: string) => cancelRun(id), onSuccess: () => refreshRuns(queryClient) });
}

export function useCancelBatch() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: string) => cancelBatch(id), onSuccess: () => refreshRuns(queryClient) });
}

/** A finished run's audio levels (the recording lanes). `enabled`: only once the run is over (409 before). */
export function useRunLevels(id: string, options: { enabled?: boolean; bins?: number } = {}) {
  const { enabled = true, bins = LEVEL_BINS } = options;
  return useQuery({
    queryKey: levelsKey(id, bins),
    queryFn: ({ signal }) => getRunLevels(id, bins, signal),
    enabled,
    // A finished run's artifacts never change.
    staleTime: Infinity,
  });
}

export function useRunTrace(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: traceKey(id),
    queryFn: ({ signal }) => getRunTrace(id, signal),
    enabled: options.enabled ?? true,
  });
}

/** Re-runs a run's scenario (paid); every runs query is stale after it. */
export function useRerun() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: string) => rerunRun(id), onSuccess: () => refreshRuns(queryClient) });
}

/**
 * The Langfuse host of the agent's Langfuse connection (e.g. `https://cloud.langfuse.com`), or
 * null when it is unknown: no agent, no connection, or not loaded (yet). `enabled`: only look it up
 * when there is a trace to open.
 */
export function useLangfuseHost(agentId: string | null, options: { enabled?: boolean } = {}): string | null {
  const enabled = (options.enabled ?? true) && agentId !== null;
  const agents = useQuery({ queryKey: agentsQueryKey, queryFn: ({ signal }) => listAgents(signal), enabled });
  const connectionId = agents.data?.find((agent) => agent.id === agentId)?.langfuseConnectionId ?? null;
  const connections = useQuery({
    queryKey: connectionsQueryKey,
    queryFn: ({ signal }) => listConnections(signal),
    enabled: enabled && connectionId !== null,
  });
  const connection = connections.data?.find((item) => item.id === connectionId && item.kind === "langfuse");
  const host = connection?.config.host;
  return typeof host === "string" && /^https?:\/\//.test(host) ? host.replace(/\/+$/, "") : null;
}
