"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiKey, listApiKeys, revokeApiKey } from "./api";
import type { ApiKey } from "./types";

export const apiKeysQueryKey = ["api-keys"] as const;

export function useApiKeys() {
  return useQuery({ queryKey: apiKeysQueryKey, queryFn: ({ signal }) => listApiKeys(signal) });
}

/**
 * Deliberately does not touch the list cache: the response holds the secret, so the caller
 * keeps it only while the one-time view is open and refreshes the list when that closes.
 */
export function useCreateApiKey() {
  return useMutation({ mutationFn: createApiKey });
}

export function useRefreshApiKeys() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
}

/** Shows the key as revoked right away, then refetches the server's view. */
export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: ApiKey) => revokeApiKey(key.id),
    onSuccess: (_, key) => {
      const revokedAt = new Date().toISOString();
      queryClient.setQueryData<ApiKey[]>(apiKeysQueryKey, (list) =>
        list?.map((item) => (item.id === key.id ? { ...item, revokedAt } : item)),
      );
      return queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
    },
  });
}
