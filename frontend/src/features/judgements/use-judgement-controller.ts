"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { runsQueryKey } from "@/features/runs/queries";
import { errorMessage } from "@/lib/api";
import { useNow } from "@/lib/time/use-now";
import { briefFileName, isJudging } from "./format";
import { useJudgement, useRejudge } from "./queries";
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
  };
}
