import { http, HttpResponse } from "msw/http";
import { apiUrl, server } from "@/test/server";
import type { OverviewStats } from "./types";

export function statsFixture(overrides: Partial<OverviewStats> = {}): OverviewStats {
  return {
    periodDays: 7,
    runs: { count: 128, previousCount: 94 },
    averageScore: 74.2,
    goalCompletion: 0.81,
    latency: { p50Ms: 1200, p95Ms: 2900 },
    live: { active: 0 },
    weakestCriteria: [],
    suggestions: { open: 0, highPriority: 0 },
    ...overrides,
  };
}

/** Serves `GET /api/stats/overview` with the given stats (or an error status); records the queries. */
export function mockStatsApi(stats: OverviewStats | { status: number; detail: string } = statsFixture()) {
  const state = { queries: [] as string[] };
  server.use(
    http.get(apiUrl("/stats/overview"), ({ request }) => {
      state.queries.push(new URL(request.url).searchParams.toString());
      return "detail" in stats
        ? HttpResponse.json({ detail: stats.detail }, { status: stats.status })
        : HttpResponse.json(stats);
    }),
  );
  return state;
}
