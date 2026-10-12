import Link from "next/link";
import { useId } from "react";
import { SCORE_TEXT, ScoreBar, buttonClasses, cn, scoreTone } from "@/ui";
import type { OverviewStats } from "./types";

/** Weakest criteria and suggestions of the window; `stats` is undefined when they are unknown. */
export function InsightsColumn({ stats }: { stats: OverviewStats | undefined }) {
  return (
    <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
      <WeakestCriteria stats={stats} />
      <Suggestions stats={stats} />
    </div>
  );
}

const UNKNOWN = "Unavailable until the metrics load.";

function WeakestCriteria({ stats }: { stats: OverviewStats | undefined }) {
  const headingId = "weakest-criteria";
  const criteria = stats?.weakestCriteria ?? [];
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-base font-semibold">
          Weakest criteria
        </h2>
        <span className="text-xs text-dim">{`Average judge score, last ${stats?.periodDays ?? 7} days`}</span>
      </div>
      {!stats ? (
        <p className="text-sm text-muted">{UNKNOWN}</p>
      ) : criteria.length === 0 ? (
        <p className="text-sm text-muted">{`No judged criteria in the last ${stats.periodDays} days.`}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {criteria.map((criterion) => (
            <li key={`${criterion.scenarioName}\u0000${criterion.text}`} className="flex flex-col gap-1.5">
              <div className="flex justify-between gap-2 text-[13px]">
                <span className="flex min-w-0 flex-col">
                  <span>{criterion.text}</span>
                  <span className="text-xs text-dim">{`${criterion.scenarioName} · ${criterion.judged} judged`}</span>
                </span>
                <span className={cn("font-semibold tabular-nums", SCORE_TEXT[scoreTone(criterion.averageScore)])}>
                  {criterion.averageScore.toFixed(1)}
                </span>
              </div>
              <ScoreBar score={criterion.averageScore} label={`${criterion.text} average score`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Suggestions({ stats }: { stats: OverviewStats | undefined }) {
  const headingId = "handoff-suggestions";
  const open = stats?.suggestions.open ?? null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3.5 rounded-xl border border-line bg-panel p-5">
      <h2 id={headingId} className="text-base font-semibold">
        Suggestions ready for handoff
      </h2>
      <div className="flex gap-6">
        <Figure label="open" value={open} />
        <Figure label="high impact" value={stats?.suggestions.highPriority ?? null} danger />
      </div>
      {!stats ? (
        <p className="text-[13px] text-muted">{UNKNOWN}</p>
      ) : open === 0 ? (
        <p className="text-[13px] text-muted">No suggestions to hand off yet.</p>
      ) : (
        <>
          <p className="text-[13px] leading-normal text-muted">
            From the judge&apos;s reports across runs, ready to export to your coding agent.
          </p>
          <Link href="/runs" className={buttonClasses("secondary", "text-[13px]")}>
            Review suggestions
          </Link>
        </>
      )}
    </section>
  );
}

function Figure({ label, value, danger = false }: { label: string; value: number | null; danger?: boolean }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-0.5">
      <span className={cn("text-[28px] font-semibold tabular-nums", danger && value ? "text-danger-fg" : undefined)}>
        {value ?? "—"}
      </span>
      <span id={labelId} className="text-xs text-muted">
        {label}
      </span>
    </div>
  );
}
