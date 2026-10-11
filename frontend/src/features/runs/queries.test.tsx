import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useRuns } from "./queries";
import { mockRunsApi, runFixture } from "./testing";

const POLL_MS = 20;

function renderRuns() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRuns({}, { pollActiveMs: POLL_MS }), { wrapper });
}

describe("useRuns", () => {
  it("keeps polling while a finished run is being judged and stops once the judgement settles", async () => {
    const api = mockRunsApi([runFixture({ judgementStatus: "judging" })]);
    const { result } = renderRuns();

    await waitFor(() => expect(api.listQueries.length).toBeGreaterThanOrEqual(3));

    api.runs = api.runs.map((run) => ({ ...run, judgementStatus: "completed", score: 72 }));
    await waitFor(() => expect(result.current.data?.items[0].judgementStatus).toBe("completed"));
    const settled = api.listQueries.length;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 6));
    expect(api.listQueries.length).toBe(settled);
  });

  it("does not poll when every run and judgement is terminal", async () => {
    const api = mockRunsApi([runFixture({ judgementStatus: "completed", score: 72 })]);
    const { result } = renderRuns();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 6));
    expect(api.listQueries).toHaveLength(1);
  });
});
