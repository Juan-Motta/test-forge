"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, CopyButton } from "@/ui";
import { clock, endReasonLabel, runDurationMs } from "./format";
import { runKind, textModeLabel } from "./kind";
import { RunStatusChip } from "./RunStatusChip";
import type { RunDetail } from "./types";

/** "Lucía · hurried · es-MX" from the run's snapshot. */
export function personaLine(detail: Pick<RunDetail, "snapshot">): string {
  const persona = detail.snapshot?.scenario?.persona;
  return persona ? [persona.name, persona.temperament, persona.locale].filter(Boolean).join(" · ") : "";
}

const EVALUATOR_LABELS = { pipeline: "Pipeline evaluator", realtime: "Realtime evaluator" } as const;

/** "Realtime evaluator · gpt-realtime-2.1" from the snapshot; undefined on runs launched before the choice. */
export function evaluatorLabel(run: Pick<RunDetail, "snapshot">): string | undefined {
  const mode = run.snapshot?.scenario?.evaluatorMode;
  const realtimeModel = mode === "realtime" ? run.snapshot?.scenario?.realtimeModel : undefined;
  return mode ? [EVALUATOR_LABELS[mode], realtimeModel].filter(Boolean).join(" · ") : undefined;
}

/** The run's short id as the report shows it: its first 8 characters. */
export const shortRunId = (id: string) => id.slice(0, 8);

/**
 * Report header: breadcrumb eyebrow, the run's short id and scenario, and chips for how it ended,
 * who took part, how long it took, the thread id (the Langfuse session, copyable) and the evaluator.
 */
export function RunHeader({ run, actions }: { run: RunDetail; actions?: ReactNode }) {
  const kind = runKind(run);
  const reason = endReasonLabel(run.endReason, kind);
  // Text runs have no evaluator voice: the chip names the agent's kind and mode instead.
  const evaluator =
    kind === "text" ? ["Text agent", textModeLabel(run)].filter(Boolean).join(" · ") : evaluatorLabel(run);
  const durationMs = run.summary?.durationMs ?? runDurationMs(run);
  const persona = personaLine(run);

  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <nav aria-label="Breadcrumb" data-eyebrow className="text-[13px] text-dim">
          <Link href="/runs" className="text-dim hover:text-fg">
            Runs
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href={`/runs?batchId=${encodeURIComponent(run.batchId)}`} className="text-dim hover:text-fg">
            {`Batch ${shortRunId(run.batchId)}`}
          </Link>
        </nav>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] break-words">
          <span className="font-mono font-medium text-muted" title={`Run ${run.id}`}>
            {shortRunId(run.id)}
          </span>{" "}
          {run.scenarioName}
        </h1>
        <ul aria-label="Run details" className="flex flex-wrap items-center gap-2">
          <li>
            <RunStatusChip status={run.status} />
          </li>
          {reason && reason !== "Cancelled" ? (
            <li>
              <Badge tone="muted">{reason}</Badge>
            </li>
          ) : null}
          <li>
            <Badge tone="muted">{run.agentName}</Badge>
          </li>
          {persona ? (
            <li>
              <Badge tone="muted">{persona}</Badge>
            </li>
          ) : null}
          {durationMs !== null ? (
            <li>
              <Badge tone="muted" mono>
                <span className="sr-only">Duration </span>
                {clock(durationMs)}
              </Badge>
            </li>
          ) : null}
          <li>
            <Badge tone="muted" mono className="max-w-full py-0 pr-0.5">
              <span className="min-w-0 whitespace-normal break-all">thread {run.threadId}</span>
              <CopyButton
                text={run.threadId}
                label="Copy thread id"
                copiedMessage="Thread id copied"
                iconSize={13}
                className="size-7 min-h-0 min-w-0"
              />
            </Badge>
          </li>
          {evaluator ? (
            <li>
              <Badge tone="outline">{evaluator}</Badge>
            </li>
          ) : null}
        </ul>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}
