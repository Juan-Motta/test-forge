import { cn } from "@/ui";
import { shortId } from "./format";
import { KindBadge } from "./KindBadge";
import { RUN_METRICS, RunActions, RunResult, RunScore, RunStarted, RunStatus } from "./run-fields";
import { TruncatedText } from "./TruncatedText";
import type { Run } from "./types";

const HEAD = "border-b border-line px-2.5 py-2 font-medium";
const CELL = "border-b border-line-soft px-2.5 py-3";

type RunsTableProps = {
  runs: Run[];
  onCancel: (run: Run) => void;
  /** Id of the run being cancelled, if any. */
  cancellingId?: string;
  now: number;
  /** Classes of the scrolling box, e.g. to show the table on wide screens only. */
  className?: string;
};

/** Runs as a table: one row per run with its status, timing and actions. */
export function RunsTable({ runs, onCancel, cancellingId, now, className }: RunsTableProps) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border border-line bg-panel px-3 py-2", className)}>
      <table aria-label="Runs" className="w-full min-w-[80rem] border-collapse text-left text-[13px]">
        <thead className="text-dim">
          <tr>
            <th scope="col" className={HEAD}>Run</th>
            <th scope="col" className={HEAD}>Scenario</th>
            <th scope="col" className={HEAD}>Agent</th>
            <th scope="col" className={HEAD}>Persona</th>
            {RUN_METRICS.map((metric) => (
              <th key={metric.label} scope="col" className={HEAD} title={metric.hint}>
                {metric.label}
              </th>
            ))}
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
            const label = shortId(run.id);
            return (
              <tr key={run.id} className="[&:last-child>td]:border-b-0">
                <td className={cn(CELL, "whitespace-nowrap font-mono text-xs text-muted")} title={run.id}>
                  {label}
                </td>
                <td className={cn(CELL, "font-medium")}>
                  <TruncatedText text={run.scenarioName} className="max-w-[18rem]" />
                </td>
                <td className={cn(CELL, "text-muted")}>
                  <span className="flex items-center gap-1.5">
                    <TruncatedText text={run.agentName} className="max-w-[14rem]" />
                    <KindBadge run={run} />
                  </span>
                </td>
                <td className={cn(CELL, "text-muted")}>
                  {run.persona ? <TruncatedText text={run.persona} className="max-w-[9rem]" /> : "—"}
                </td>
                {RUN_METRICS.map((metric) => (
                  <td key={metric.label} className={cn(CELL, "whitespace-nowrap font-mono text-xs text-muted")}>
                    {metric.value(run, now)}
                  </td>
                ))}
                <td className={CELL}>
                  <RunStatus run={run} />
                </td>
                <td className={CELL}>
                  <RunScore run={run} label={label} />
                </td>
                <td className={CELL}>
                  <RunResult run={run} fallback={<span className="font-mono text-xs text-muted">—</span>} />
                </td>
                <td className={cn(CELL, "whitespace-nowrap text-xs text-dim")}>
                  <RunStarted run={run} now={now} />
                </td>
                <td className={CELL}>
                  <div className="flex justify-end gap-2">
                    <RunActions run={run} label={label} onCancel={onCancel} cancelling={cancellingId === run.id} />
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
