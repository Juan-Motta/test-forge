"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createApi, deleteApi, getApi, listApis, listFlows, updateApi } from "./api";
import type { Api, ApiChanges } from "./types";

// Revealed secret values are never stored here: see `useSecretReveal`.
export const apisQueryKey = ["apis"] as const;
const apisListKey = [...apisQueryKey, "list"] as const;
export const apiQueryKey = (id: string) => [...apisQueryKey, "item", id] as const;
export const flowsQueryKey = ["flows"] as const;
const flowsListKey = (apiId: string) => [...flowsQueryKey, "list", { apiId }] as const;

export function useApis() {
  return useQuery({ queryKey: apisListKey, queryFn: ({ signal }) => listApis(signal) });
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
