"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { runsQueryKey } from "@/features/runs/queries";
import { errorMessage } from "@/lib/api";
import { useNow } from "@/lib/time/use-now";
import { briefFileName, isJudging } from "./format";
import { useJudgement, useRejudge } from "./queries";
import { ScoreSection } from "./ScoreSection";

const POLL_MS = 3000;

type ScoreContainerProps = {
  runId: string;
  endedAt: string | null;
  /** Polling interval while the judgement is in progress (tests shorten it). */
  pollMs?: number;
};

/** Container of a finished run's "Score & suggestions": loads, polls and re-judges its judgement. */
export function ScoreContainer({ runId, endedAt, pollMs = POLL_MS }: ScoreContainerProps) {
  const queryClient = useQueryClient();
  const judgement = useJudgement(runId, { pollMs, endedAt });
  const rejudge = useRejudge(runId);
  const [copied, setCopied] = useState(false);
  const now = useNow(1000);
  const status = judgement.data?.status;

  // Once a judgement finishes, the run's score and judgement status in every runs query are stale.
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
    URL.revokeObjectURL(url);
  }

  return (
    <ScoreSection
      judgement={judgement.data}
      loadError={judgement.isError ? errorMessage(judgement.error) : null}
      onReload={() => judgement.refetch()}
      onJudge={() => {
        setCopied(false);
        rejudge.mutate();
      }}
      judgeStarting={rejudge.isPending}
      judgeError={rejudge.isError ? errorMessage(rejudge.error) : null}
      onCopyBrief={copyBrief}
      briefCopied={copied}
      onDownloadBrief={downloadBrief}
      now={now}
    />
  );
}
