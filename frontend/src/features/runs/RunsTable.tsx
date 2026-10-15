import { useFormat, useT } from "@/lib/i18n";
import { cn } from "@/ui";
import { shortId } from "./format";
import { RUN_METRICS, RunActions, RunIdentity, RunOutcome, RunStarted, type RunMetric } from "./run-fields";
import type { Run } from "./types";

const HEAD = "border-b border-line px-2 py-2 align-bottom font-medium";
const CELL = "border-b border-line-soft px-2 py-3 align-top";
const FIGURE = "font-mono text-xs text-muted";

/**
 * Column widths of the fixed table layout, in `RUN_METRICS` order for the metrics. The scenario
 * takes whatever is left: the fixed columns add up to about 43rem, so at a 1280px screen (about
 * 59rem of table) the scenario keeps about 15rem, and nothing scrolls sideways.
 */
const METRIC_WIDTHS: Record<RunMetric["id"], string> = {
  duration: "w-[4rem]",
  turns: "w-[4rem]",
  latency: "w-[5.25rem]",
  cost: "w-[6rem]",
};

type RunsTableProps = {
  runs: Run[];
  onCancel: (run: Run) => void;
  /** Id of the run being cancelled, if any. */
  cancellingId?: string;
  now: number;
  /** Classes of the table's box, e.g. to show the table on wide screens only. */
  className?: string;
};

/**
 * Runs as a compact table: one row per run, its scenario cell carrying the agent, persona and run
 * id, and one outcome column for the score, the result and (when it matters) the status.
 */
export function RunsTable({ runs, onCancel, cancellingId, now, className }: RunsTableProps) {
  const t = useT();
  const format = useFormat();
  return (
    // Fits without scrolling from the xl breakpoint where it is shown; the floor keeps the
    // scenario column readable, and the box scrolls instead of crushing it if it ever gets narrower.
    <div className={cn("overflow-x-auto rounded-xl border border-line bg-panel px-3 py-2", className)}>
      <table aria-label={t("runs.listLabel")} className="w-full min-w-[56rem] table-fixed border-collapse text-left text-[13px]">
        <thead className="text-dim">
          <tr>
            <th scope="col" className={HEAD}>
              {t("runs.column.scenario")}
            </th>
            {RUN_METRICS.map((metric) => (
              <th
                key={metric.id}
                scope="col"
                className={cn(HEAD, METRIC_WIDTHS[metric.id])}
                title={metric.hint ? t(metric.hint) : undefined}
              >
                {t(metric.label)}
              </th>
            ))}
            <th scope="col" className={cn(HEAD, "w-[8.5rem]")}>
              {t("runs.column.outcome")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[7rem]")}>
              {t("runs.column.started")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[8.5rem]")}>
              <span className="sr-only">{t("common.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const label = shortId(run.id);
            return (
              <tr key={run.id} className="[&:last-child>td]:border-b-0">
                <td className={CELL}>
                  <RunIdentity run={run} />
                </td>
                {RUN_METRICS.map((metric) => {
                  const value = metric.value(run, now, format);
                  return (
                    <td key={metric.id} className={cn(CELL, FIGURE, "truncate")} title={value}>
                      {value}
                    </td>
                  );
                })}
                <td className={CELL}>
                  <RunOutcome run={run} label={label} />
                </td>
                <td className={cn(CELL, "text-xs text-dim")}>
                  <RunStarted run={run} now={now} />
                </td>
                <td className={CELL}>
                  <div className="flex flex-wrap justify-end gap-2">
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
