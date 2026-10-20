import Link from "next/link";
import type { ReactNode } from "react";
import { formatDuration } from "@/features/apiflows/run-view";
import { useFormat, useT, type Format, type Translator } from "@/lib/i18n";
import { Badge, cn, focusRing } from "@/ui";
import { KindBadge } from "./KindBadge";
import { RUN_METRICS, RunResult, RunStarted } from "./run-fields";
import { flowRunHref, type RunEntry } from "./run-entries";
import { RunStatusChip } from "./RunStatusChip";
import { TruncatedText } from "./TruncatedText";

const HEAD = "border-b border-line px-2 py-2 align-bottom font-medium";
const CELL = "border-b border-line-soft px-2 py-3 align-top";
const FIGURE = "font-mono text-xs text-muted";
const DURATION = RUN_METRICS.find((metric) => metric.id === "duration")!;

type RunEntriesListProps = {
  entries: RunEntry[];
  now: number;
  /** Accessible name of the table and of the cards. */
  label: string;
  /** Adds the Steps column (the API flows view, where every row is a flow run). */
  showSteps?: boolean;
};

/** What one row shows, whichever kind of run it is. */
type EntryView = {
  key: string;
  href: string;
  name: string;
  /** Who ran: the agent of an agent run, the API of a flow run. */
  owner: string;
  kind: ReactNode;
  status: ReactNode;
  steps: string;
  duration: string;
  when: ReactNode;
};

function viewOf(entry: RunEntry, now: number, t: Translator, format: Format): EntryView {
  if (entry.kind === "agent") {
    const { run } = entry;
    return {
      key: `agent:${run.id}`,
      href: `/runs/${encodeURIComponent(run.id)}`,
      name: run.scenarioName,
      owner: run.agentName,
      kind: <KindBadge run={run} />,
      status: (
        <span className="flex flex-wrap items-start gap-1.5">
          <RunResult run={run} />
          <RunStatusChip status={run.status} />
        </span>
      ),
      steps: "—",
      duration: DURATION.value(run, now, format),
      when: <RunStarted run={run} now={now} />,
    };
  }
  const { run } = entry;
  return {
    key: `flow:${run.id}`,
    href: flowRunHref(run),
    name: run.flowName,
    owner: run.apiName,
    kind: (
      <Badge tone="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
        {t("runs.kind.flow")}
      </Badge>
    ),
    status: <Badge tone={run.status === "passed" ? "success" : "danger"}>{t(`flowRuns.status.${run.status}`)}</Badge>,
    steps: t.plural("runs.stepCount", run.stepCount),
    duration: formatDuration(run.durationMs, format.number),
    when: (
      <time dateTime={run.createdAt} title={format.absoluteTime(run.createdAt)}>
        {format.relativeTime(run.createdAt, now)}
      </time>
    ),
  };
}

/**
 * Runs of either kind: a compact table on wide screens and cards on phones (one shows at a time,
 * by CSS). The name opens the run: an agent run's report, or a flow run's view inside its API.
 */
export function RunEntriesList({ entries, now, label, showSteps = false }: RunEntriesListProps) {
  const t = useT();
  const format = useFormat();
  const views = entries.map((entry) => viewOf(entry, now, t, format));
  const nameLink = (view: EntryView, className?: string) => (
    <Link href={view.href} title={view.name} className={cn("min-w-0 rounded font-medium hover:underline", focusRing, className)}>
      <span className="block truncate">{view.name}</span>
    </Link>
  );
  const owner = (view: EntryView) => (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
      <TruncatedText text={view.owner} className="min-w-0" />
      {view.kind}
    </span>
  );

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-panel px-3 py-2 md:block">
        <table aria-label={label} className="w-full min-w-[40rem] table-fixed border-collapse text-left text-[13px]">
          <thead className="text-dim">
            <tr>
              <th scope="col" className={HEAD}>
                {showSteps ? t("flowsPage.column.flow") : t("runs.listLabel")}
              </th>
              <th scope="col" className={cn(HEAD, "w-[11rem]")}>
                {t("runs.filter.status")}
              </th>
              {showSteps ? (
                <th scope="col" className={cn(HEAD, "w-[6rem]")}>
                  {t("flowsPage.column.steps")}
                </th>
              ) : null}
              <th scope="col" className={cn(HEAD, "w-[6rem]")}>
                {t("runs.metric.duration")}
              </th>
              <th scope="col" className={cn(HEAD, "w-[8rem]")}>
                {t("runs.column.started")}
              </th>
            </tr>
          </thead>
          <tbody>
            {views.map((view) => (
              <tr key={view.key} className="[&:last-child>td]:border-b-0">
                <td className={CELL}>
                  <div className="flex min-w-0 flex-col gap-1">
                    {nameLink(view, "w-fit max-w-full")}
                    {owner(view)}
                  </div>
                </td>
                <td className={CELL}>{view.status}</td>
                {showSteps ? <td className={cn(CELL, FIGURE)}>{view.steps}</td> : null}
                <td className={cn(CELL, FIGURE)}>{view.duration}</td>
                <td className={cn(CELL, "text-xs text-dim")}>{view.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={label} className="grid gap-3 sm:grid-cols-2 md:hidden">
        {views.map((view) => (
          <li key={view.key} className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-panel p-4 text-[13px]">
            <div className="flex items-start justify-between gap-3">
              {nameLink(view, "text-sm")}
              <div className="shrink-0">{view.status}</div>
            </div>
            {owner(view)}
            <p className="flex flex-wrap gap-x-3 text-xs text-muted">
              {showSteps ? <span className="font-mono">{view.steps}</span> : null}
              <span className="font-mono">{view.duration}</span>
              <span>{view.when}</span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
