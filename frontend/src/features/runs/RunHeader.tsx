"use client";

import { useState } from "react";
import { Badge, IconButton, CheckIcon, CopyIcon } from "@/ui";
import { endReasonLabel, shortId } from "./format";
import { RunStatusChip } from "./RunStatusChip";
import type { RunDetail } from "./types";

/** "Lucía · hurried · es-MX" from the run's snapshot. */
export function personaLine(detail: Pick<RunDetail, "snapshot">): string {
  const persona = detail.snapshot?.scenario?.persona;
  return persona ? [persona.name, persona.temperament, persona.locale].filter(Boolean).join(" · ") : "";
}

const EVALUATOR_LABELS = { pipeline: "Pipeline evaluator", realtime: "Realtime evaluator" } as const;

/** Who, against whom, how it ended, and the thread id (the Langfuse session) with a copy button. */
export function RunMeta({ run }: { run: RunDetail }) {
  const [copied, setCopied] = useState(false);
  const reason = endReasonLabel(run.endReason);
  const mode = run.snapshot?.scenario?.evaluatorMode;
  const realtimeModel = mode === "realtime" ? run.snapshot?.scenario?.realtimeModel : undefined;
  const evaluator = mode ? [EVALUATOR_LABELS[mode], realtimeModel].filter(Boolean).join(" · ") : undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(run.threadId);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
      <RunStatusChip status={run.status} />
      {reason && reason !== "Cancelled" ? <span>{reason}</span> : null}
      <span aria-hidden="true">·</span>
      <span>{run.agentName}</span>
      {personaLine(run) ? (
        <>
          <span aria-hidden="true">·</span>
          <Badge tone="evaluator">{personaLine(run)}</Badge>
        </>
      ) : null}
      {evaluator ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{evaluator}</span>
        </>
      ) : null}
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1 font-mono text-xs" title={run.threadId}>
        thread {shortId(run.threadId)}
        <IconButton
          label="Copy thread id"
          className="size-8"
          icon={copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          onClick={copy}
        />
      </span>
      <span role="status" className="sr-only">
        {copied ? "Thread id copied" : ""}
      </span>
    </div>
  );
}
