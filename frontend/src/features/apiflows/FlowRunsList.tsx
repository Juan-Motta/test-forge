import Link from "next/link";
import { TruncatedText } from "@/features/runs/TruncatedText";
import { useFormat, useT } from "@/lib/i18n";
import { Badge, cn, focusRing } from "@/ui";
import { runHref } from "./links";
import { formatDuration } from "./run-view";
import type { FlowRunSummary } from "./types";

const HEAD = "border-b border-line px-2 py-2 align-bottom font-medium";
const CELL = "border-b border-line-soft px-2 py-3 align-top";
const FIGURE = "font-mono text-xs text-muted";

type FlowRunsListProps = {
  runs: FlowRunSummary[];
  now: number;
};

/**
 * Runs of every API flow: a compact table on wide screens and cards on phones (one shows at a
 * time, by CSS, so the hidden one is out of the a11y tree too). The flow name opens the run view.
 */
export function FlowRunsList({ runs, now }: FlowRunsListProps) {
  const t = useT();
  const format = useFormat();
  const label = t("flowRunsPage.listLabel");
  const name = (run: FlowRunSummary, className?: string) => (
    <Link
      href={runHref({ id: run.apiId }, run.flowId, run.id)}
      title={run.flowName}
      className={cn("min-w-0 rounded font-medium hover:underline", focusRing, className)}
    >
      <span className="block truncate">{run.flowName}</span>
    </Link>
  );
  const api = (run: FlowRunSummary) => <TruncatedText text={run.apiName} className="min-w-0 text-xs text-muted" />;
  const status = (run: FlowRunSummary) => (
    <Badge tone={run.status === "passed" ? "success" : "danger"}>{t(`flowRuns.status.${run.status}`)}</Badge>
  );
  const steps = (run: FlowRunSummary) => t.plural("flowRunsPage.stepCount", run.stepCount);
  const duration = (run: FlowRunSummary) => formatDuration(run.durationMs, format.number);
  const when = (run: FlowRunSummary) => (
    <time dateTime={run.createdAt} title={format.absoluteTime(run.createdAt)}>
      {format.relativeTime(run.createdAt, now)}
    </time>
  );

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-panel px-3 py-2 md:block">
        <table aria-label={label} className="w-full min-w-[40rem] table-fixed border-collapse text-left text-[13px]">
          <thead className="text-dim">
            <tr>
              <th scope="col" className={HEAD}>
                {t("flowsPage.column.flow")}
              </th>
              <th scope="col" className={cn(HEAD, "w-[8rem]")}>
                {t("runs.filter.status")}
              </th>
              <th scope="col" className={cn(HEAD, "w-[6rem]")}>
                {t("flowsPage.column.steps")}
              </th>
              <th scope="col" className={cn(HEAD, "w-[6rem]")}>
                {t("runs.metric.duration")}
              </th>
              <th scope="col" className={cn(HEAD, "w-[8rem]")}>
                {t("flowRunsPage.column.when")}
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="[&:last-child>td]:border-b-0">
                <td className={CELL}>
                  <div className="flex min-w-0 flex-col gap-1">
                    {name(run, "w-fit max-w-full")}
                    {api(run)}
                  </div>
                </td>
                <td className={CELL}>{status(run)}</td>
                <td className={cn(CELL, FIGURE)}>{steps(run)}</td>
                <td className={cn(CELL, FIGURE)}>{duration(run)}</td>
                <td className={cn(CELL, "text-xs text-dim")}>{when(run)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={label} className="grid gap-3 sm:grid-cols-2 md:hidden">
        {runs.map((run) => (
          <li key={run.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-panel p-4 text-[13px]">
            <div className="flex items-start justify-between gap-3">
              {name(run, "text-sm")}
              <div className="shrink-0">{status(run)}</div>
            </div>
            {api(run)}
            <p className="flex flex-wrap gap-x-3 text-xs text-muted">
              <span className="font-mono">{steps(run)}</span>
              <span className="font-mono">{duration(run)}</span>
              <span>{when(run)}</span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
