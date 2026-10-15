"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runsQueryKey } from "@/features/runs/queries";
import { useLocale, type Locale } from "@/lib/i18n";
import { getJudgement, rejudge, translateJudgement } from "./api";
import { isJudging } from "./format";
import type { Judgement } from "./types";

/** Without `locale`, the prefix of every language's query of the run (for invalidation). */
export const judgementQueryKey = (runId: string, locale?: Locale) =>
  locale ? (["judgement", runId, locale] as const) : (["judgement", runId] as const);

type JudgementOptions = {
  enabled?: boolean;
  /** Refetch at this interval while the judgement (or its translation) is in progress. */
  pollMs?: number;
  /**
   * When the run ended: a just-finished run may not be handed to the judge yet, so `none` keeps
   * polling for `settleMs` after it.
   */
  endedAt?: string | null;
  settleMs?: number;
};

const DEFAULT_SETTLE_MS = 60_000;

/** True while the judgement's version in `locale` is still being written (English needs none). */
export function isTranslating(judgement: Judgement | undefined, locale: Locale): boolean {
  return locale !== "en" && judgement?.status === "completed" && judgement.translationStatus === "pending";
}

/** The run's judgement in the page language (English until that version is ready). */
export function useJudgement(runId: string, options: JudgementOptions = {}) {
  const { enabled = true, pollMs, endedAt, settleMs = DEFAULT_SETTLE_MS } = options;
  const locale = useLocale();
  return useQuery({
    queryKey: judgementQueryKey(runId, locale),
    queryFn: ({ signal }) => getJudgement(runId, locale, signal),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data;
      const status = data?.status;
      if (!pollMs || !status) return false;
      if (isJudging(status) || isTranslating(data, locale)) return pollMs;
      const ended = endedAt ? Date.parse(endedAt) : Number.NaN;
      return status === "none" && Date.now() - ended < settleMs ? pollMs : false;
    },
  });
}

/** Judge the run again; its judgement and every runs query (score, status) are stale after it. */
export function useRejudge(runId: string) {
  const queryClient = useQueryClient();
  const locale = useLocale();
  return useMutation({
    mutationFn: () => rejudge(runId),
    onSuccess: (judgement) => {
      queryClient.setQueryData(judgementQueryKey(runId, locale), judgement);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: judgementQueryKey(runId) }),
        queryClient.invalidateQueries({ queryKey: runsQueryKey }),
      ]);
    },
  });
}

/** Translate the completed judgement into the page language; the query then polls until it is ready. */
export function useTranslateJudgement(runId: string) {
  const queryClient = useQueryClient();
  const locale = useLocale();
  return useMutation({
    mutationFn: () => translateJudgement(runId, locale),
    onSuccess: (judgement) => queryClient.setQueryData(judgementQueryKey(runId, locale), judgement),
  });
}
