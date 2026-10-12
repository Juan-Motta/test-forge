import Link from "next/link";
import { absoluteTime, relativeTime } from "@/features/connections/format";
import { isJudging } from "@/features/judgements/format";
import { needsReview } from "@/features/overview/run-result";
import { Badge, Button, ScoreBar, buttonClasses, cn } from "@/ui";
import { STATUS_LABELS, clock, endReasonLabel, isActive, latency, runDurationMs, shortId } from "./format";
import { RunStatusChip } from "./RunStatusChip";
import type { Run } from "./types";

const HEAD = "border-b border-line px-2.5 py-2 font-medium";
const CELL = "border-b border-line-soft px-2.5 py-3";

type RunsTableProps = {
  runs: Run[];
  onCancel: (run: Run) => void;
  /** Id of the run being cancelled, if any. */
  cancellingId?: string;
  now: number;
};

/** Runs as a table: one row per run with its status, timing and actions. */
export function RunsTable({ runs, onCancel, cancellingId, now }: RunsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel px-3 py-2">
      <table aria-label="Runs" className="w-full min-w-[76rem] border-collapse text-left text-[13px]">
        <thead className="text-dim">
          <tr>
            <th scope="col" className={HEAD}>Run</th>
            <th scope="col" className={HEAD}>Scenario</th>
            <th scope="col" className={HEAD}>Agent</th>
            <th scope="col" className={HEAD}>Persona</th>
            <th scope="col" className={HEAD}>Duration</th>
            <th scope="col" className={HEAD} title="Caller turns / agent turns">
              Turns
            </th>
            <th scope="col" className={HEAD} title="Median agent response latency">
              p50 latency
            </th>
            <th scope="col" className={HEAD}>Status</th>
            <th scope="col" className={HEAD}>Score</th>
            <th scope="col" className={HEAD}>Result</th>
            <th scope="col" className={HEAD}>Started</th>
            <th scope="col" className={HEAD}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const duration = runDurationMs(run, now);
            const reason = endReasonLabel(run.endReason);
            const showReason = reason && !isActive(run.status) && reason !== STATUS_LABELS[run.status];
            const label = shortId(run.id);
            return (
              <tr key={run.id} className="[&:last-child>td]:border-b-0">
                <td className={cn(CELL, "font-mono text-xs text-muted")}>{label}</td>
                <td className={cn(CELL, "font-medium")}>{run.scenarioName}</td>
                <td className={cn(CELL, "text-muted")}>{run.agentName}</td>
                <td className={cn(CELL, "text-muted")}>{run.persona ?? "—"}</td>
                <td className={cn(CELL, "font-mono text-xs text-muted")}>{duration === null ? "—" : clock(duration)}</td>
                <td className={cn(CELL, "font-mono text-xs text-muted")}>{turnsLabel(run)}</td>
                <td className={cn(CELL, "font-mono text-xs text-muted")}>{latency(run.latencyP50Ms)}</td>
                <td className={CELL}>
                  <div className="flex flex-col items-start gap-1">
                    <RunStatusChip status={run.status} />
                    {showReason ? <span className="text-xs text-muted">{reason}</span> : null}
                  </div>
                </td>
                <td className={CELL}>
                  <RunScore run={run} label={label} />
                </td>
                <td className={CELL}>
                  <RunResult run={run} />
                </td>
                <td className={cn(CELL, "whitespace-nowrap text-xs text-dim")}>
                  {run.startedAt ? (
                    <time dateTime={run.startedAt} title={absoluteTime(run.startedAt)}>
                      {relativeTime(run.startedAt, now)}
                    </time>
                  ) : (
                    "Not started"
                  )}
                </td>
                <td className={CELL}>
                  <div className="flex justify-end gap-2">
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
                          loading={cancellingId === run.id}
                          aria-label={`Cancel run ${label}`}
                          onClick={() => onCancel(run)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : null}
                    <Link
                      href={`/runs/${encodeURIComponent(run.id)}`}
                      aria-label={`Open run ${label}`}
                      className={buttonClasses("secondary", "min-h-9 px-3")}
                    >
                      Open
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The judge's overall score as a number and a bar, or where its judgement stands. */
function RunScore({ run, label }: { run: Run; label: string }) {
  const score = run.score ?? null;
  if (score === null && isJudging(run.judgementStatus)) return <span className="text-xs text-muted">Judging…</span>;
  if (score === null && run.judgementStatus === "failed") return <span className="text-xs text-danger-fg">Failed</span>;
  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-7 font-mono tabular-nums", score === null ? "text-xs text-muted" : "text-sm font-semibold")}>
        {score ?? "—"}
      </span>
      <ScoreBar score={score} label={`Score of run ${label}`} trackClassName="w-16" />
    </div>
  );
}

/** Judged runs: passed, or flagged for a human review (score under 60 or a must criterion failed). */
function RunResult({ run }: { run: Run }) {
  if (run.score === null || run.score === undefined) return <span className="font-mono text-xs text-muted">—</span>;
  return needsReview(run) ? <Badge tone="evaluator">Needs review</Badge> : <Badge tone="success">Passed</Badge>;
}

/** "caller / agent" turns, or a dash while either is unknown. */
function turnsLabel(run: Run): string {
  return run.callerTurns == null || run.agentTurns == null ? "—" : `${run.callerTurns} / ${run.agentTurns}`;
}
