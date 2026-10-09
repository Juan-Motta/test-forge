import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  connectionsQueryKey,
  useCreateConnection,
  useDeleteConnection,
  useTestStoredConnection,
  useUpdateConnection,
} from "./queries";
import { connectionFixture, mockConnectionsApi } from "./testing";
import type { Connection } from "./types";

const first = connectionFixture();
const second = connectionFixture({ id: "c-2", name: "Backup" });
const failed = { at: "2026-10-09T10:00:00Z", ok: false, detail: "Authentication failed (HTTP 401)" };

/** A client whose list is cached but not observed, so invalidation marks it stale without refetching. */
function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData<Connection[]>(connectionsQueryKey, [first, second]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const cached = () => queryClient.getQueryData<Connection[]>(connectionsQueryKey);
  const invalidated = () => queryClient.getQueryState(connectionsQueryKey)?.isInvalidated;
  return { wrapper, cached, invalidated };
}

describe("connection queries", () => {
  it("removes a deleted connection from the cached list right away and marks the list stale", async () => {
    mockConnectionsApi([first, second]);
    const { wrapper, cached, invalidated } = setup();
    const { result } = renderHook(() => useDeleteConnection(), { wrapper });

    await act(() => result.current.mutateAsync(first));

    expect(cached()).toEqual([second]);
    expect(invalidated()).toBe(true);
  });

  it("writes a stored test result onto the matching cached connection only", async () => {
    mockConnectionsApi([first, second], { storedResult: failed });
    const { wrapper, cached, invalidated } = setup();
    const { result } = renderHook(() => useTestStoredConnection(), { wrapper });

    await act(() => result.current.mutateAsync(second));

    expect(cached()).toEqual([first, { ...second, lastTest: failed }]);
    expect(invalidated()).toBe(true);
  });

  it("marks the list stale after a create or an update", async () => {
    mockConnectionsApi([first, second]);
    const created = setup();
    const create = renderHook(() => useCreateConnection(), { wrapper: created.wrapper });
    await act(() =>
      create.result.current.mutateAsync({ name: "New", kind: "openai", config: {}, secrets: { apiKey: "sk-x" } }),
    );
    expect(created.invalidated()).toBe(true);

    const updated = setup();
    const update = renderHook(() => useUpdateConnection(), { wrapper: updated.wrapper });
    await act(() => update.result.current.mutateAsync({ id: first.id, changes: { name: "Renamed" } }));
    expect(updated.invalidated()).toBe(true);
    expect(updated.cached()).toEqual([first, second]); // refreshed by refetching, not patched locally
  });
});
