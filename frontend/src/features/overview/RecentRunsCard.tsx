"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { absoluteTime, relativeTime } from "@/features/connections/format";
import { clock, runDurationMs, shortId } from "@/features/runs/format";
import { TruncatedText } from "@/features/runs/TruncatedText";
import type { Run } from "@/features/runs/types";
import { Badge, FilterChips, ScoreBar, cn, focusRing } from "@/ui";
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
 * scenario takes a fixed share and agent and persona split the rest, all three ellipsized, so ids
 * and names stay on one line. The minimum width fits the card beside the insights column at
 * 1280px and up; narrower, the card scrolls sideways.
 */
const COLUMNS: readonly Column[] = [
  {
    name: "Run",
    width: "w-[6.25rem]",
    cellClassName: "whitespace-nowrap",
    cell: (run) => (
      <Link
        href={`/runs/${encodeURIComponent(run.id)}`}
        title={run.id}
        aria-label={`Open run ${run.id}`}
        className={cn("rounded font-mono text-xs text-agent hover:underline", focusRing)}
      >
        {shortId(run.id)}
      </Link>
    ),
  },
  { name: "Scenario", width: "w-[19%]", cellClassName: "font-medium", cell: (run) => <TruncatedText text={run.scenarioName} /> },
  { name: "Agent", width: "", cellClassName: "text-muted", cell: (run) => <TruncatedText text={run.agentName} /> },
  {
    name: "Persona",
    width: "",
    cellClassName: "text-muted",
    cell: (run) => (run.persona ? <TruncatedText text={run.persona} /> : "—"),
  },
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
  const cell = "border-b border-line-soft px-2 py-3";

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
        <div className="overflow-x-auto">
          <table
            aria-labelledby={headingId}
            className="w-full min-w-[720px] table-fixed border-collapse text-left text-[13px]"
          >
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
      )}
    </section>
  );
}
