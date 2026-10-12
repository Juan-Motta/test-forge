"use client";

import { useRuns } from "@/features/runs/queries";

const POLL_MS = 5000;
// Same filters as the overview counts, so the cache is shared.
const ONE = { limit: 1 } as const;

/** Queued + connecting + running runs (list totals), polled; null until every count is known. */
export function useActiveRunCount(): number | null {
  const queued = useRuns({ ...ONE, status: "queued" }, { refetchInterval: POLL_MS });
  const connecting = useRuns({ ...ONE, status: "connecting" }, { refetchInterval: POLL_MS });
  const running = useRuns({ ...ONE, status: "running" }, { refetchInterval: POLL_MS });
  const counts = [queued, connecting, running];
  return counts.every((query) => query.data !== undefined)
    ? counts.reduce((sum, query) => sum + (query.data?.total ?? 0), 0)
    : null;
}
