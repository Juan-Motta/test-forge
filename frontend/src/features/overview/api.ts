import { apiFetch } from "@/lib/api";
import type { OverviewStats } from "./types";

/** Aggregates over the runs created in the last `days` days (1-90). */
export function getOverviewStats(days: number, signal?: AbortSignal): Promise<OverviewStats> {
  return apiFetch<OverviewStats>(`/stats/overview?days=${days}`, { signal });
}
