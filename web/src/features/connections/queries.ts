"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createConnection,
  deleteConnection,
  listConnections,
  testDraftConnection,
  testStoredConnection,
  updateConnection,
} from "./api";
import type { Connection, ConnectionChanges, LastTest } from "./types";

export const connectionsQueryKey = ["connections"] as const;

export function useConnections() {
  return useQuery({ queryKey: connectionsQueryKey, queryFn: ({ signal }) => listConnections(signal) });
}

function useInvalidateConnections() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
}

export function useCreateConnection() {
  const invalidate = useInvalidateConnections();
  return useMutation({ mutationFn: createConnection, onSuccess: invalidate });
}

export function useUpdateConnection() {
  const invalidate = useInvalidateConnections();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: ConnectionChanges }) => updateConnection(id, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connection: Connection) => deleteConnection(connection.id),
    onSuccess: (_, connection) => {
      queryClient.setQueryData<Connection[]>(connectionsQueryKey, (list) =>
        list?.filter((item) => item.id !== connection.id),
      );
      return queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
    },
  });
}

/** Tests the stored credentials and shows the new `lastTest` right away, then refetches. */
export function useTestStoredConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connection: Connection) => testStoredConnection(connection.id),
    onSuccess: (lastTest: LastTest, connection) => {
      queryClient.setQueryData<Connection[]>(connectionsQueryKey, (list) =>
        list?.map((item) => (item.id === connection.id ? { ...item, lastTest } : item)),
      );
      return queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
    },
  });
}

export function useTestDraftConnection() {
  return useMutation({ mutationFn: testDraftConnection });
}
