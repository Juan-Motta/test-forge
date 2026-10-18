import Link from "next/link";
import type { ReactNode } from "react";
import { isJudging } from "@/features/judgements/format";
import { runCostLabel } from "@/features/pricing/format";
import { runResult } from "@/features/overview/run-result";
import { useFormat, useT, type Format, type MessageKey } from "@/lib/i18n";
import { Badge, ScoreBar, cn, focusRing } from "@/ui";
import { clock, endReasonLabel, endReasonRepeatsStatus, isActive, latency, runDurationMs } from "./format";
import { KindBadge } from "./KindBadge";
import { runKind } from "./kind";
import { RunStatusChip } from "./RunStatusChip";
import { TruncatedText } from "./TruncatedText";
import type { Run } from "./types";

/**
 * The run figures shared by the runs table (one column each) and the run cards (one term each),
 * so both views always show the same values under the same names.
 */
export type RunMetric = {
  id: "duration" | "turns" | "latency" | "cost";
  label: MessageKey;
  /** What the figure means, shown as the header's tooltip. */
  hint?: MessageKey;
  value: (run: Run, now: number, format: Format) => string;
};

export const RUN_METRICS: readonly RunMetric[] = [
  {
    id: "duration",
    label: "runs.metric.duration",
    value: (run, now) => {
      const duration = runDurationMs(run, now);
      return duration === null ? "—" : clock(duration);
    },
  },
  { id: "turns", label: "runs.metric.turns", hint: "runs.metric.turnsHint", value: (run) => turnsLabel(run) },
  { id: "latency", label: "runs.metric.latency", hint: "runs.metric.latencyHint", value: (run) => latency(run.latencyP50Ms) },
  {
    id: "cost",
    label: "runs.metric.cost",
    hint: "runs.metric.costHint",
    value: (run, _now, format) => runCostLabel(format, run.cost),
  },
];

/** "caller / agent" turns, or a dash while either is unknown. */
function turnsLabel(run: Run): string {
  return run.callerTurns == null || run.agentTurns == null ? "—" : `${run.callerTurns} / ${run.agentTurns}`;
}

/** When the run started; a run that never started (queued, or cancelled or failed while queued)
 * says so and shows when it was queued instead. */
export function RunStarted({ run, now }: { run: Run; now: number }) {
  const t = useT();
  const { absoluteTime, relativeTime } = useFormat();
  if (run.startedAt) {
    return (
      <time dateTime={run.startedAt} title={absoluteTime(run.startedAt)}>
        {relativeTime(run.startedAt, now)}
      </time>
    );
  }
  return (
    <span className="text-muted">
      {`${t("runs.notStarted")} · ${t("runs.queued")} `}
      <time dateTime={run.createdAt} title={absoluteTime(run.createdAt)}>
        {relativeTime(run.createdAt, now)}
      </time>
    </span>
  );
}

/**
 * A table's two-line run cell: the scenario, linked to the report, and under it, muted, the agent
 * and its kind and the persona (the run id lives in the report header and on the cards). Every
 * name is ellipsized with its full text in a title, so the cell never widens its column.
 */
export function RunIdentity({ run }: { run: Run }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Link
        href={`/runs/${encodeURIComponent(run.id)}`}
        title={run.scenarioName}
        className={cn("block min-w-0 truncate rounded font-medium hover:underline", focusRing)}
      >
        {run.scenarioName}
      </Link>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
        <TruncatedText text={run.agentName} className="min-w-0 shrink" />
        <KindBadge run={run} />
        {run.persona ? (
          <>
            <span aria-hidden="true" className="text-dim">
              ·
            </span>
            <TruncatedText text={run.persona} className="min-w-0 shrink-[2]" />
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The table's outcome: the score and the judged result, plus the status (and why the run ended)
 * only when it says something, that is when the run is still going or did not complete normally.
 */
export function RunOutcome({ run, label }: { run: Run; label: string }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <RunScore run={run} label={label} trackClassName="w-12" />
      <RunResult run={run} />
      {run.status === "completed" ? null : <RunStatus run={run} />}
    </div>
  );
}

/** The status chip and, when it adds something, why the run ended. */
export function RunStatus({ run }: { run: Run }) {
  const t = useT();
  const reason = endReasonLabel(t, run.endReason, runKind(run));
  const showReason = reason && !isActive(run.status) && !endReasonRepeatsStatus(run.status, run.endReason);
  return (
    <div className="flex flex-col items-start gap-1">
      <RunStatusChip status={run.status} />
      {showReason ? <span className="text-xs text-muted">{reason}</span> : null}
    </div>
  );
}

/** The judge's overall score as a number and a bar, or where its judgement stands. */
export function RunScore({ run, label, trackClassName = "w-16" }: { run: Run; label: string; trackClassName?: string }) {
  const t = useT();
  const score = run.score ?? null;
  if (score === null && isJudging(run.judgementStatus)) {
    return <span className="text-xs text-muted">{t("runs.result.judging")}</span>;
  }
  if (score === null && run.judgementStatus === "failed") {
    return <span className="text-xs text-danger-fg">{t("runs.status.failed")}</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-7 font-mono tabular-nums", score === null ? "text-xs text-muted" : "text-sm font-semibold")}>
        {score ?? "—"}
      </span>
      <ScoreBar score={score} label={t("runs.scoreOf", { id: label })} trackClassName={trackClassName} />
    </div>
  );
}

/**
 * The overview's verdict (`runResult`) for judged runs: passed, or flagged for a human review. A
 * broken (failed, interrupted) or cancelled call is never "Passed"; its status already says what
 * happened, so this one is empty (`fallback`), like a run in progress or unscored.
 */
export function RunResult({ run, fallback = null }: { run: Run; fallback?: ReactNode }) {
  const t = useT();
  const result = runResult(t, run);
  if (result.kind === "passed" || result.kind === "review") return <Badge tone={result.tone}>{result.label}</Badge>;
  return <>{fallback}</>;
}
