"use client";

import { useQuery } from "@tanstack/react-query";
import { getOverviewStats } from "./api";

export const overviewStatsKey = (days: number) => ["stats", "overview", days] as const;

export function useOverviewStats(days: number, options: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: overviewStatsKey(days),
    queryFn: ({ signal }) => getOverviewStats(days, signal),
    refetchInterval: options.refetchInterval,
    placeholderData: (previous) => previous,
  });
}
