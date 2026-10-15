"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { runsQueryKey } from "@/features/runs/queries";
import { errorMessage } from "@/lib/api";
import { useNow } from "@/lib/time/use-now";
import { briefFileName, isJudging } from "./format";
import { useLocale } from "@/lib/i18n";
import { isTranslating, useJudgement, useRejudge, useTranslateJudgement } from "./queries";
import type { Judgement } from "./types";

export const JUDGEMENT_POLL_MS = 3000;
/** Revoking the object URL in the same tick as the click can abort the download in some browsers. */
export const REVOKE_BRIEF_URL_MS = 1000;

export type JudgementController = {
  judgement: Judgement | undefined;
  loadError: string | null;
  reload: () => void;
  /** Starts a (re-)judgement. */
  judge: () => void;
  judgeStarting: boolean;
  judgeError: string | null;
  /** The completed judgement's brief, "" otherwise. */
  brief: string;
  copyBrief: () => void;
  briefCopied: boolean;
  downloadBrief: () => void;
  now: number;
  /**
   * The completed judgement's version in the page language: `english` when the page is not English
   * and that version is missing (never made, or failed), `translating` while it is being written,
   * null when the judgement already reads in the page language (or is not completed).
   */
  translation: "english" | "translating" | null;
  /** Why the last translation failed (from the API), shown with `english`. */
  translationError: string | null;
  /** Starts the translation into the page language (a small paid call). */
  translate: () => void;
  translateStarting: boolean;
  translateRequestError: string | null;
};

type Options = {
  /** `enabled`: false while the run is still in progress (nothing to judge yet). */
  enabled?: boolean;
  endedAt: string | null;
  /** Polling interval while the judgement is in progress (tests shorten it). */
  pollMs?: number;
};

/** Loads, polls and re-judges a run's judgement; copies and downloads its brief. */
export function useJudgementController(runId: string, options: Options): JudgementController {
  const { enabled = true, endedAt, pollMs = JUDGEMENT_POLL_MS } = options;
  const queryClient = useQueryClient();
  const judgement = useJudgement(runId, { enabled, pollMs, endedAt });
  const rejudge = useRejudge(runId);
  const translate = useTranslateJudgement(runId);
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const now = useNow(1000);
  const status = judgement.data?.status;

  // Once a judgement finishes, the run's score, judgement status and trace in every runs query are stale.
  const previous = useRef(status);
  useEffect(() => {
    if (isJudging(previous.current) && status !== undefined && !isJudging(status)) {
      void queryClient.invalidateQueries({ queryKey: runsQueryKey });
    }
    previous.current = status;
  }, [status, queryClient]);

  const brief = judgement.data?.status === "completed" ? (judgement.data.result?.brief ?? "") : "";
  const data = judgement.data;
  const completed = data?.status === "completed" && data.result !== null;
  const translation = !completed
    ? null
    : isTranslating(data, locale)
      ? "translating"
      : locale !== "en" && data.language !== locale
        ? "english"
        : null;

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function downloadBrief() {
    const url = URL.createObjectURL(new Blob([brief], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = briefFileName(runId);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_BRIEF_URL_MS);
  }

  return {
    judgement: judgement.data,
    loadError: judgement.isError ? errorMessage(judgement.error) : null,
    reload: () => void judgement.refetch(),
    judge: () => {
      setCopied(false);
      rejudge.mutate();
    },
    judgeStarting: rejudge.isPending,
    judgeError: rejudge.isError ? errorMessage(rejudge.error) : null,
    brief,
    copyBrief: () => void copyBrief(),
    briefCopied: copied,
    downloadBrief,
    now,
    translation,
    translationError: translation === "english" && data?.translationStatus === "failed" ? (data.translationError ?? null) : null,
    translate: () => translate.mutate(),
    translateStarting: translate.isPending,
    translateRequestError: translate.isError ? errorMessage(translate.error) : null,
  };
}
