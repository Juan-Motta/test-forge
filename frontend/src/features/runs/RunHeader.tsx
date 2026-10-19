"use client";

import type { ReactNode } from "react";
import { Breadcrumbs } from "@/features/shell/Breadcrumbs";
import { useT, type Translator } from "@/lib/i18n";
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

const EVALUATOR_LABELS = { pipeline: "runs.evaluator.pipeline", realtime: "runs.evaluator.realtime" } as const;

/** "Realtime evaluator · gpt-realtime-2.1" from the snapshot; undefined on runs launched before the choice. */
export function evaluatorLabel(t: Translator, run: Pick<RunDetail, "snapshot">): string | undefined {
  const mode = run.snapshot?.scenario?.evaluatorMode;
  const realtimeModel = mode === "realtime" ? run.snapshot?.scenario?.realtimeModel : undefined;
  return mode ? [t(EVALUATOR_LABELS[mode]), realtimeModel].filter(Boolean).join(" · ") : undefined;
}

/** The run's short id as the report shows it: its first 8 characters. */
export const shortRunId = (id: string) => id.slice(0, 8);

/**
 * Report header: breadcrumbs back to the runs and the batch, the run's short id and scenario, and chips for how it ended,
 * who took part, how long it took, the thread id (the Langfuse session, copyable) and the evaluator.
 */
export function RunHeader({ run, actions }: { run: RunDetail; actions?: ReactNode }) {
  const t = useT();
  const kind = runKind(run);
  const reason = endReasonLabel(t, run.endReason, kind);
  // Text runs have no evaluator voice: the chip names the agent's kind and mode instead.
  const evaluator =
    kind === "text"
      ? [t("runs.textAgent"), textModeLabel(t, run)].filter(Boolean).join(" · ")
      : evaluatorLabel(t, run);
  const durationMs = run.summary?.durationMs ?? runDurationMs(run);
  const persona = personaLine(run);

  return (
    <header className="flex flex-col gap-2">
      <Breadcrumbs
        items={[
          { label: t("nav.runs"), href: "/runs" },
          { label: t("runs.batch", { id: shortRunId(run.batchId) }), href: `/runs?batchId=${encodeURIComponent(run.batchId)}` },
        ]}
      />
      <h1 className="text-[28px] font-semibold tracking-[-0.02em] break-words">
        <span className="font-mono font-medium text-muted" title={t("runs.runId", { id: run.id })}>
          {shortRunId(run.id)}
        </span>{" "}
        {run.scenarioName}
      </h1>
      {/* Chips and actions share one row, centred on each other rather than on a baseline. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <ul aria-label={t("runs.details")} className="flex min-w-0 flex-wrap items-center gap-2">
          <li>
            <RunStatusChip status={run.status} size="md" />
          </li>
          {reason && run.endReason !== "cancelled" ? (
            <li>
              <Badge tone="muted" size="md">{reason}</Badge>
            </li>
          ) : null}
          <li>
            <Badge tone="muted" size="md">{run.agentName}</Badge>
          </li>
          {persona ? (
            <li>
              <Badge tone="muted" size="md">{persona}</Badge>
            </li>
          ) : null}
          {durationMs !== null ? (
            <li>
              <Badge tone="muted" size="md" mono>
                <span className="sr-only">{`${t("report.metric.duration")} `}</span>
                {clock(durationMs)}
              </Badge>
            </li>
          ) : null}
          <li>
            {/* The copy button fits the chip's own height, so every chip in the row lines up. */}
            <Badge tone="muted" size="md" mono className="max-w-full pr-1.5">
              <span className="min-w-0 whitespace-normal break-all">{t("runs.thread", { id: run.threadId })}</span>
              <CopyButton
                text={run.threadId}
                label={t("runs.copyThreadId")}
                copiedMessage={t("runs.threadIdCopied")}
                iconSize={12}
                size="xs"
              />
            </Badge>
          </li>
          {evaluator ? (
            <li>
              <Badge tone="muted" size="md">{evaluator}</Badge>
            </li>
          ) : null}
        </ul>
        {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
      </div>
    </header>
  );
}
