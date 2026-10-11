import Link from "next/link";
import { absoluteTime, relativeTime } from "@/features/connections/format";
import { isJudging } from "@/features/judgements/format";
import { Button, buttonClasses } from "@/ui";
import { STATUS_LABELS, clock, endReasonLabel, isActive, runDurationMs, shortId } from "./format";
import { RunStatusChip } from "./RunStatusChip";
import type { Run } from "./types";

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
    <div className="overflow-x-auto rounded-xl border border-line bg-panel">
      <table aria-label="Runs" className="w-full min-w-[56rem] text-left text-sm">
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Run</th>
            <th scope="col" className="px-4 py-3 font-medium">Scenario</th>
            <th scope="col" className="px-4 py-3 font-medium">Agent</th>
            <th scope="col" className="px-4 py-3 font-medium">Duration</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
            <th scope="col" className="px-4 py-3 font-medium">Score</th>
            <th scope="col" className="px-4 py-3 font-medium">Started</th>
            <th scope="col" className="px-4 py-3 font-medium">
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
              <tr key={run.id} className="border-b border-line-soft last:border-b-0">
                <td className="px-4 py-3 font-mono text-xs text-muted">{label}</td>
                <td className="px-4 py-3 font-medium">{run.scenarioName}</td>
                <td className="px-4 py-3 text-muted">{run.agentName}</td>
                <td className="px-4 py-3 font-mono text-xs">{duration === null ? "—" : clock(duration)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <RunStatusChip status={run.status} />
                    {showReason ? <span className="text-xs text-muted">{reason}</span> : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <RunScore run={run} />
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {run.startedAt ? (
                    <time dateTime={run.startedAt} title={absoluteTime(run.startedAt)}>
                      {relativeTime(run.startedAt, now)}
                    </time>
                  ) : (
                    "Not started"
                  )}
                </td>
                <td className="px-4 py-3">
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

/** The judge's overall score, or where its judgement stands. */
function RunScore({ run }: { run: Run }) {
  if (run.score !== null && run.score !== undefined) {
    return <span className="font-mono text-sm font-semibold">{run.score}</span>;
  }
  if (isJudging(run.judgementStatus)) return <span className="text-xs text-muted">Judging…</span>;
  if (run.judgementStatus === "failed") return <span className="text-xs text-danger-fg">Failed</span>;
  return <span className="font-mono text-xs text-muted">—</span>;
}
