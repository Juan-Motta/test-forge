"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runsQueryKey } from "@/features/runs/queries";
import { getJudgement, rejudge } from "./api";
import { isJudging } from "./format";

export const judgementQueryKey = (runId: string) => ["judgement", runId] as const;

type JudgementOptions = {
  enabled?: boolean;
  /** Refetch at this interval while the judgement is in progress. */
  pollMs?: number;
  /**
   * When the run ended: a just-finished run may not be handed to the judge yet, so `none` keeps
   * polling for `settleMs` after it.
   */
  endedAt?: string | null;
  settleMs?: number;
};

const DEFAULT_SETTLE_MS = 60_000;

export function useJudgement(runId: string, options: JudgementOptions = {}) {
  const { enabled = true, pollMs, endedAt, settleMs = DEFAULT_SETTLE_MS } = options;
  return useQuery({
    queryKey: judgementQueryKey(runId),
    queryFn: ({ signal }) => getJudgement(runId, signal),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!pollMs || !status) return false;
      if (isJudging(status)) return pollMs;
      const ended = endedAt ? Date.parse(endedAt) : Number.NaN;
      return status === "none" && Date.now() - ended < settleMs ? pollMs : false;
    },
  });
}

/** Judge the run again; its judgement and every runs query (score, status) are stale after it. */
export function useRejudge(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rejudge(runId),
    onSuccess: (judgement) => {
      queryClient.setQueryData(judgementQueryKey(runId), judgement);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: judgementQueryKey(runId) }),
        queryClient.invalidateQueries({ queryKey: runsQueryKey }),
      ]);
    },
  });
}
