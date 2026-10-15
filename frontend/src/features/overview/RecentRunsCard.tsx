"use client";

import { useState, type ReactNode } from "react";
import { absoluteTime, relativeTime } from "@/features/connections/format";
import { clock, runDurationMs, shortId } from "@/features/runs/format";
import { RunCards } from "@/features/runs/RunCards";
import { RunIdentity } from "@/features/runs/run-fields";
import type { Run } from "@/features/runs/types";
import { Badge, FilterChips, ScoreBar, cn } from "@/ui";
import { isFailedRun, needsReview, runResult } from "./run-result";

type RunFilter = "all" | "failed" | "review";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failed" },
  { value: "review", label: "Needs review" },
] as const;

const MATCHES: Record<RunFilter, (run: Run) => boolean> = {
  all: () => true,
  failed: isFailedRun,
  review: needsReview,
};

const SHOWN = 10;

type Column = {
  name: string;
  /** Header width; the cells follow it (the table has a fixed layout). */
  width: string;
  /** Extra classes of this column's body cells. */
  cellClassName?: string;
  cell: (run: Run, now: number) => ReactNode;
};

const roundedScore = (run: Run) => (run.score === null || run.score === undefined ? null : Math.round(run.score));

/**
 * One definition per column: its header, width and body cell. Fixed widths for the short columns;
 * the scenario takes the rest, a two-line cell (`RunIdentity`) that also carries the agent,
 * persona and run id, all ellipsized. The fixed columns add up to 24rem, so the table fits the
 * card at every width it shows at (1024px and up, beside the insights column or below it) without
 * scrolling sideways; below 1024px the card shows the runs as cards instead.
 */
const COLUMNS: readonly Column[] = [
  { name: "Scenario", width: "", cell: (run) => <RunIdentity run={run} /> },
  {
    name: "Duration",
    width: "w-[4.5rem]",
    cellClassName: "whitespace-nowrap font-mono text-xs text-muted",
    cell: (run, now) => {
      const duration = runDurationMs(run, now);
      return duration === null ? "—" : clock(duration);
    },
  },
  {
    name: "Score",
    width: "w-[5.5rem]",
    cell: (run) => (
      <div className="flex items-center gap-2">
        <span className="w-6 font-semibold tabular-nums">{roundedScore(run) ?? "—"}</span>
        <ScoreBar score={roundedScore(run)} label={`Score of run ${shortId(run.id)}`} trackClassName="w-10" />
      </div>
    ),
  },
  {
    name: "Result",
    width: "w-[7rem]",
    cellClassName: "whitespace-nowrap",
    cell: (run) => {
      const result = runResult(run);
      return <Badge tone={result.tone}>{result.label}</Badge>;
    },
  },
  {
    name: "When",
    width: "w-[7rem]",
    cellClassName: "whitespace-nowrap text-dim",
    cell: (run, now) => (
      <time dateTime={run.createdAt} title={absoluteTime(run.createdAt)}>
        {relativeTime(run.createdAt, now)}
      </time>
    ),
  },
];

/** Whether a run matches the free-text search (scenario, agent, persona, run or thread id). */
export function matchesSearch(run: Run, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [run.id, run.threadId, run.scenarioName, run.agentName, run.persona ?? ""].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

/** The latest runs, filtered client-side by result chips and the header search. */
export function RecentRunsCard({ runs, search, now }: { runs: Run[]; search: string; now: number }) {
  const [filter, setFilter] = useState<RunFilter>("all");
  const headingId = "recent-runs";
  const shown = runs.filter((run) => MATCHES[filter](run) && matchesSearch(run, search)).slice(0, SHOWN);
  const cell = "border-b border-line-soft px-2 py-3 align-top";

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-[999_1_640px] flex-col gap-3.5 rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-base font-semibold">
          Recent runs
        </h2>
        <FilterChips label="Filter runs" options={FILTERS} selected={[filter]} onToggle={setFilter} />
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {search.trim() ? "No recent runs match." : "No recent runs in this view."}
        </p>
      ) : (
        <>
          <div className="hidden lg:block">
            <table aria-labelledby={headingId} className="w-full table-fixed border-collapse text-left text-[13px]">
              <thead className="text-dim">
                <tr>
                  {COLUMNS.map(({ name, width }) => (
                    <th key={name} scope="col" className={cn("whitespace-nowrap border-b border-line px-2 py-2 font-medium", width)}>
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((run) => (
                  <tr key={run.id}>
                    {COLUMNS.map((column) => (
                      <td key={column.name} className={cn(cell, column.cellClassName)}>
                        {column.cell(run, now)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <RunCards runs={shown} now={now} label="Recent runs" className="lg:hidden" />
        </>
      )}
    </section>
  );
}
