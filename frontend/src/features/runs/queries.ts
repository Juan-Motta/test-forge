"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelBatch, cancelRun, getBatch, getRun, launchRuns, listBatches, listRuns } from "./api";
import { isJudging } from "@/features/judgements/format";
import { isActive } from "./format";
import type { RunFilters } from "./types";

export const runsQueryKey = ["runs"] as const;
const listKey = (filters: RunFilters) => [...runsQueryKey, "list", filters] as const;
export const runQueryKey = (id: string) => [...runsQueryKey, "item", id] as const;
const batchesKey = (page: { limit?: number; offset?: number }) => [...runsQueryKey, "batches", page] as const;
const batchKey = (id: string) => [...runsQueryKey, "batch", id] as const;

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
