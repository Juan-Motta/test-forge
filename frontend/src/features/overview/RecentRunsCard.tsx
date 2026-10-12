"use client";

import Link from "next/link";
import { useState } from "react";
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

/**
 * Fixed widths for the short columns; scenario takes a fixed share and agent and persona split
 * the rest, all three ellipsized, so ids and names stay on one line. The minimum width fits the
 * card beside the insights column at 1280px and up; narrower, the card scrolls sideways.
 */
const COLUMNS = [
  { name: "Run", width: "w-[6.25rem]" },
  { name: "Scenario", width: "w-[19%]" },
  { name: "Agent", width: "" },
  { name: "Persona", width: "" },
  { name: "Duration", width: "w-[4.5rem]" },
  { name: "Score", width: "w-[5.5rem]" },
  { name: "Result", width: "w-[7rem]" },
  { name: "When", width: "w-[7rem]" },
] as const;

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
              {shown.map((run) => {
                const label = shortId(run.id);
                const duration = runDurationMs(run, now);
                const result = runResult(run);
                const score = run.score === null || run.score === undefined ? null : Math.round(run.score);
                return (
                  <tr key={run.id}>
                    <td className={cn(cell, "whitespace-nowrap")}>
                      <Link
                        href={`/runs/${encodeURIComponent(run.id)}`}
                        title={run.id}
                        aria-label={`Open run ${run.id}`}
                        className={cn("rounded font-mono text-xs text-agent hover:underline", focusRing)}
                      >
                        {label}
                      </Link>
                    </td>
                    <td className={cn(cell, "font-medium")}>
                      <TruncatedText text={run.scenarioName} />
                    </td>
                    <td className={cn(cell, "text-muted")}>
                      <TruncatedText text={run.agentName} />
                    </td>
                    <td className={cn(cell, "text-muted")}>
                      {run.persona ? <TruncatedText text={run.persona} /> : "—"}
                    </td>
                    <td className={cn(cell, "whitespace-nowrap font-mono text-xs text-muted")}>
                      {duration === null ? "—" : clock(duration)}
                    </td>
                    <td className={cell}>
                      <div className="flex items-center gap-2">
                        <span className="w-6 font-semibold tabular-nums">{score ?? "—"}</span>
                        <ScoreBar score={score} label={`Score of run ${label}`} trackClassName="w-10" />
                      </div>
                    </td>
                    <td className={cn(cell, "whitespace-nowrap")}>
                      <Badge tone={result.tone}>{result.label}</Badge>
                    </td>
                    <td className={cn(cell, "whitespace-nowrap text-dim")}>
                      <time dateTime={run.createdAt} title={absoluteTime(run.createdAt)}>
                        {relativeTime(run.createdAt, now)}
                      </time>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
