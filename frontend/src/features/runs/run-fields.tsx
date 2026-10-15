import Link from "next/link";
import type { ReactNode } from "react";
import { absoluteTime, relativeTime } from "@/features/connections/format";
import { isJudging } from "@/features/judgements/format";
import { runCostLabel } from "@/features/pricing/format";
import { runResult } from "@/features/overview/run-result";
import { Badge, Button, ScoreBar, buttonClasses, cn } from "@/ui";
import { STATUS_LABELS, clock, endReasonLabel, isActive, latency, runDurationMs } from "./format";
import { runKind } from "./kind";
import { RunStatusChip } from "./RunStatusChip";
import type { Run } from "./types";

/**
 * The run figures shared by the runs table (one column each) and the run cards (one term each),
 * so both views always show the same values under the same names.
 */
export type RunMetric = {
  label: string;
  /** What the figure means, shown as the header's tooltip. */
  hint?: string;
  value: (run: Run, now: number) => string;
};

export const RUN_METRICS: readonly RunMetric[] = [
  {
    label: "Duration",
    value: (run, now) => {
      const duration = runDurationMs(run, now);
      return duration === null ? "—" : clock(duration);
    },
  },
  { label: "Turns", hint: "Caller turns / agent turns", value: (run) => turnsLabel(run) },
  { label: "p50 latency", hint: "Median agent response latency", value: (run) => latency(run.latencyP50Ms) },
  {
    label: "Cost",
    hint: "The evaluator's approximate cost: its caller and its judge (OpenAI list prices)",
    value: (run) => runCostLabel(run.cost),
  },
];

/** "caller / agent" turns, or a dash while either is unknown. */
function turnsLabel(run: Run): string {
  return run.callerTurns == null || run.agentTurns == null ? "—" : `${run.callerTurns} / ${run.agentTurns}`;
}

/** When the run started; a run that never started (queued, or cancelled or failed while queued)
 * says so and shows when it was queued instead. */
export function RunStarted({ run, now }: { run: Run; now: number }) {
  if (run.startedAt) {
    return (
      <time dateTime={run.startedAt} title={absoluteTime(run.startedAt)}>
        {relativeTime(run.startedAt, now)}
      </time>
    );
  }
  return (
    <span className="text-muted">
      Not started ·{" queued "}
      <time dateTime={run.createdAt} title={absoluteTime(run.createdAt)}>
        {relativeTime(run.createdAt, now)}
      </time>
    </span>
  );
}

/** The status chip and, when it adds something, why the run ended. */
export function RunStatus({ run }: { run: Run }) {
  const reason = endReasonLabel(run.endReason, runKind(run));
  const showReason = reason && !isActive(run.status) && reason !== STATUS_LABELS[run.status];
  return (
    <div className="flex flex-col items-start gap-1">
      <RunStatusChip status={run.status} />
      {showReason ? <span className="text-xs text-muted">{reason}</span> : null}
    </div>
  );
}

/** The judge's overall score as a number and a bar, or where its judgement stands. */
export function RunScore({ run, label, trackClassName = "w-16" }: { run: Run; label: string; trackClassName?: string }) {
  const score = run.score ?? null;
  if (score === null && isJudging(run.judgementStatus)) return <span className="text-xs text-muted">Judging…</span>;
  if (score === null && run.judgementStatus === "failed") return <span className="text-xs text-danger-fg">Failed</span>;
  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-7 font-mono tabular-nums", score === null ? "text-xs text-muted" : "text-sm font-semibold")}>
        {score ?? "—"}
      </span>
      <ScoreBar score={score} label={`Score of run ${label}`} trackClassName={trackClassName} />
    </div>
  );
}

/**
 * The overview's verdict (`runResult`) for judged runs: passed, or flagged for a human review. A
 * broken (failed, interrupted) or cancelled call is never "Passed"; its status already says what
 * happened, so this one is empty (`fallback`), like a run in progress or unscored.
 */
export function RunResult({ run, fallback = null }: { run: Run; fallback?: ReactNode }) {
  const result = runResult(run);
  if (result.kind === "passed" || result.kind === "review") return <Badge tone={result.tone}>{result.label}</Badge>;
  return <>{fallback}</>;
}

type RunActionsProps = {
  run: Run;
  label: string;
  onCancel: (run: Run) => void;
  cancelling: boolean;
  /** Whether to offer "Open" (the cards link the scenario name to the report instead). */
  open?: boolean;
};

/** Watch live and cancel while the run is active, and open its report. */
export function RunActions({ run, label, onCancel, cancelling, open = true }: RunActionsProps) {
  return (
    <>
      {isActive(run.status) ? (
        <>
          <Link
            href={`/runs/${encodeURIComponent(run.id)}/live`}
            aria-label={`Watch run ${label} live`}
            className={buttonClasses("secondary", "min-h-9 px-3")}
          >
            Live
          </Link>
          <Button
            variant="ghost"
            className="min-h-9 px-3"
            loading={cancelling}
            aria-label={`Cancel run ${label}`}
            onClick={() => onCancel(run)}
          >
            Cancel
          </Button>
        </>
      ) : null}
      {open ? (
        <Link
          href={`/runs/${encodeURIComponent(run.id)}`}
          aria-label={`Open run ${label}`}
          className={buttonClasses("secondary", "min-h-9 px-3")}
        >
          Open
        </Link>
      ) : null}
    </>
  );
}
