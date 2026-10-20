"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createApi,
  createFlow,
  deleteApi,
  deleteFlow,
  getApi,
  getFlowRun,
  listApis,
  listAllFlowRuns,
  listFlowRuns,
  listFlows,
  runFlow,
  updateApi,
  updateFlow,
} from "./api";
import type { FlowPayload } from "./flow-draft";
import type { Api, ApiChanges, Flow, FlowRun, FlowRunSummaryFilters, RunInputs } from "./types";

// Revealed secret values are never stored here: see `useSecretReveal`.
export const apisQueryKey = ["apis"] as const;
const apisListKey = [...apisQueryKey, "list"] as const;
export const apiQueryKey = (id: string) => [...apisQueryKey, "item", id] as const;
export const flowsQueryKey = ["flows"] as const;
const flowsListKey = (apiId: string) => [...flowsQueryKey, "list", { apiId }] as const;
const allFlowsKey = [...flowsQueryKey, "all"] as const;

export function useApis(options: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: apisListKey, queryFn: ({ signal }) => listApis(signal), enabled: options.enabled ?? true });
}

export function useApi(id: string | undefined) {
  return useQuery({
    queryKey: apiQueryKey(id ?? ""),
    queryFn: ({ signal }) => getApi(id ?? "", signal),
    enabled: id !== undefined,
  });
}

/** The flows of one API, in the order the API lists them. */
export function useApiFlows(apiId: string) {
  return useQuery({ queryKey: flowsListKey(apiId), queryFn: ({ signal }) => listFlows({ apiId }, signal) });
}

/** Every flow of every API, each with its API's name and its last run. */
export function useAllFlows() {
  return useQuery({ queryKey: allFlowsKey, queryFn: ({ signal }) => listFlows({}, signal) });
}

/** Seeds the API's cache and refreshes the list (and the flows, which show the API's name). */
function storedApi(queryClient: QueryClient, api: Api) {
  queryClient.setQueryData(apiQueryKey(api.id), api);
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: apisListKey }),
    queryClient.invalidateQueries({ queryKey: flowsQueryKey }),
  ]);
}

export function useCreateApi() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: createApi, onSuccess: (api) => storedApi(queryClient, api) });
}

export function useUpdateApi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: ApiChanges }) => updateApi(id, changes),
    onSuccess: (api) => storedApi(queryClient, api),
  });
}

export function useDeleteApi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (api: Api) => deleteApi(api.id),
    onSuccess: (_, api) => {
      queryClient.removeQueries({ queryKey: apiQueryKey(api.id) });
      return queryClient.invalidateQueries({ queryKey: apisListKey });
    },
  });
}

/** A flow changes its API's flow count and agents, so both lists refresh. */
function storedFlow(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: flowsQueryKey }),
    queryClient.invalidateQueries({ queryKey: apisQueryKey }),
  ]);
}

export function useCreateFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FlowPayload & { apiId: string }) => createFlow(input),
    onSuccess: () => storedFlow(queryClient),
  });
}

export function useUpdateFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Partial<FlowPayload> }) => updateFlow(id, changes),
    onSuccess: () => storedFlow(queryClient),
  });
}

export function useDeleteFlow() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (flow: Flow) => deleteFlow(flow.id), onSuccess: () => storedFlow(queryClient) });
}

// Runs: a stored run never changes, so it is cached as it is; a new run refreshes its flow's list.
export const flowRunsQueryKey = ["flow-runs"] as const;
const flowRunsListKey = (flowId: string) => [...flowRunsQueryKey, "list", flowId] as const;
const flowRunKey = (runId: string) => [...flowRunsQueryKey, "item", runId] as const;
const allFlowRunsKey = (filters: FlowRunSummaryFilters) => [...flowRunsQueryKey, "all", filters] as const;
/** How many runs the flow editor lists. */
export const RECENT_RUNS = 10;

export function useFlowRuns(flowId: string) {
  return useQuery({ queryKey: flowRunsListKey(flowId), queryFn: ({ signal }) => listFlowRuns(flowId, RECENT_RUNS, signal) });
}

/** Runs of every flow (summaries), newest first; `enabled: false` leaves them unasked. */
export function useAllFlowRuns(filters: FlowRunSummaryFilters, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: allFlowRunsKey(filters),
    queryFn: ({ signal }) => listAllFlowRuns(filters, signal),
    enabled: options.enabled ?? true,
    placeholderData: (previous) => previous,
  });
}

export function useFlowRun(runId: string) {
  return useQuery({ queryKey: flowRunKey(runId), queryFn: ({ signal }) => getFlowRun(runId, signal) });
}

/** Seeds the new run's cache (its page opens next) and refreshes the flow's runs. */
export function storedRun(queryClient: QueryClient, run: FlowRun) {
  queryClient.setQueryData(flowRunKey(run.id), run);
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: flowRunsListKey(run.flowId) }),
    queryClient.invalidateQueries({ queryKey: [...flowRunsQueryKey, "all"] }),
    // The flows page shows each flow's last run.
    queryClient.invalidateQueries({ queryKey: allFlowsKey }),
  ]);
}

export function useRunFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ flowId, inputs }: { flowId: string; inputs: RunInputs }) => runFlow(flowId, inputs),
    onSuccess: (run) => storedRun(queryClient, run),
  });
}
