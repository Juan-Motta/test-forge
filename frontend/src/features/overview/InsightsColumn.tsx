import Link from "next/link";
import { useId } from "react";
import { useFormat, useT } from "@/lib/i18n";
import { SCORE_TEXT, ScoreBar, buttonClasses, cn, scoreTone } from "@/ui";
import type { OverviewStats } from "./types";

/**
 * Weakest criteria and suggestions of the window; `stats` is undefined when they are unknown
 * (still `loading`, or failed to load).
 */
export function InsightsColumn({ stats, loading = false }: { stats: OverviewStats | undefined; loading?: boolean }) {
  const t = useT();
  const unknown = loading ? t("overview.loadingMetrics") : t("overview.unknownMetrics");
  return (
    <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5" aria-busy={loading || undefined}>
      <WeakestCriteria stats={stats} unknown={unknown} />
      <Suggestions stats={stats} unknown={unknown} />
    </div>
  );
}

function WeakestCriteria({ stats, unknown }: { stats: OverviewStats | undefined; unknown: string }) {
  const t = useT();
  const format = useFormat();
  const headingId = "weakest-criteria";
  const criteria = stats?.weakestCriteria ?? [];
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-base font-semibold">
          {t("overview.weakest")}
        </h2>
        <span className="text-xs text-dim">{t("overview.weakestHint", { count: stats?.periodDays ?? 7 })}</span>
      </div>
      {!stats ? (
        <p className="text-sm text-muted">{unknown}</p>
      ) : criteria.length === 0 ? (
        <p className="text-sm text-muted">{t("overview.noJudgedCriteria", { count: stats.periodDays })}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {criteria.map((criterion) => (
            <li key={`${criterion.scenarioName}\u0000${criterion.text}`} className="flex flex-col gap-1.5">
              <div className="flex justify-between gap-2 text-[13px]">
                <span className="flex min-w-0 flex-col">
                  <span>{criterion.text}</span>
                  <span className="text-xs text-dim">{`${criterion.scenarioName} · ${t("overview.judgedCount", { count: criterion.judged })}`}</span>
                </span>
                <span className={cn("font-semibold tabular-nums", SCORE_TEXT[scoreTone(criterion.averageScore)])}>
                  {format.number(criterion.averageScore, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </span>
              </div>
              <ScoreBar score={criterion.averageScore} label={t("overview.criterionAverage", { criterion: criterion.text })} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Suggestions({ stats, unknown }: { stats: OverviewStats | undefined; unknown: string }) {
  const t = useT();
  const headingId = "handoff-suggestions";
  const open = stats?.suggestions.open ?? null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3.5 rounded-xl border border-line bg-panel p-5">
      <h2 id={headingId} className="text-base font-semibold">
        {t("overview.suggestions")}
      </h2>
      <div className="flex gap-6">
        <Figure label={t("overview.open")} value={open} />
        <Figure label={t("overview.highImpact")} value={stats?.suggestions.highPriority ?? null} danger />
      </div>
      {!stats ? (
        <p className="text-[13px] text-muted">{unknown}</p>
      ) : open === 0 ? (
        <p className="text-[13px] text-muted">{t("overview.noSuggestions")}</p>
      ) : (
        <>
          <p className="text-[13px] leading-normal text-muted">
            {t("overview.suggestionsHint")}
          </p>
          <Link href="/runs" className={buttonClasses("secondary", "text-[13px]")}>
            {t("overview.reviewSuggestions")}
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
