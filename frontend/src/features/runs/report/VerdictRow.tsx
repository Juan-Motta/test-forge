import type { ReactNode } from "react";
import { failureTagCountLabel, scoreBand, traceStatsLine } from "@/features/judgements/format";
import type { JudgeResult } from "@/features/judgements/types";
import { useT } from "@/lib/i18n";
import { Badge, ScoreBar, cn } from "@/ui";
import { goalsMet } from "./issues";

const CARD = "flex flex-col gap-1.5 rounded-xl border border-line bg-panel p-5";

/** Overall score, goals met and the judge's summary of a completed judgement. */
export function VerdictRow({ result, action }: { result: JudgeResult; action?: ReactNode }) {
  const t = useT();
  const score = result.overallScore;
  const band = score === null ? null : scoreBand(t, score);
  const goals = goalsMet(result.criteria);
  const unobservable = result.criteria.length - goals.observable;
  const tags = Object.entries(result.failureTags ?? {});
  const stats = result.traceStats;
  const judgedBy = [
    t("report.judgedBy", { model: result.model }),
    result.samples ? t.plural("report.samples", result.samples) : null,
  ].filter(Boolean);

  return (
    <section aria-label={t("report.verdict")} className="flex flex-wrap gap-4">
      <div role="group" aria-label={t("report.overallScore")} className={cn(CARD, "flex-[1_1_200px]")}>
        <span className="text-[13px] text-muted">{t("report.overallScore")}</span>
        <p className="flex items-baseline gap-1.5">
          <span className={cn("text-5xl font-semibold tracking-[-0.03em] tabular-nums", band?.className ?? "text-muted")}>
            {score ?? "—"}
          </span>
          <span className="text-dim">/100</span>
        </p>
        <ScoreBar score={score} label={t("report.overallScoreOf100")} className="my-1" />
        <span className="text-xs text-muted">{band ? band.label : t("report.noneObservable")}</span>
        {result.mustFailed ? (
          <span>
            <Badge tone="danger">{t("report.mustFailed")}</Badge>
          </span>
        ) : null}
      </div>
      <div role="group" aria-label={t("report.goalsMet")} className={cn(CARD, "flex-[1_1_200px]")}>
        <span className="text-[13px] text-muted">{t("report.goalsMet")}</span>
        <p className="flex items-baseline gap-1.5">
          <span className="text-5xl font-semibold tracking-[-0.03em] tabular-nums">{goals.passed}</span>
          <span className="text-dim">/ {goals.observable}</span>
        </p>
        <span className="text-xs text-muted">
          {goals.observable === 0
            ? t("report.noneObservable")
            : goals.missed
              ? t("report.missed", { criterion: goals.missed })
              : t("report.allPassed")}
        </span>
        {unobservable > 0 ? <span className="text-xs text-dim">{t("report.notObservableCount", { count: unobservable })}</span> : null}
      </div>
      <section aria-labelledby="judge-summary" className={cn(CARD, "flex-[999_1_380px] gap-2.5")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="judge-summary" className="text-[13px] font-normal text-muted">
            {t("report.judgeSummary")}
          </h2>
          {action}
        </div>
        <p className="text-[15px] leading-relaxed text-body">{result.summary}</p>
        {tags.length > 0 ? (
          <ul aria-label={t("report.failureTagCounts")} className="flex flex-wrap gap-2">
            {tags.map(([tag, count]) => (
              <li key={tag}>
                <Badge tone="danger">{failureTagCountLabel(t, tag, count)}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
        {result.strengths.length > 0 ? (
          <p className="text-xs text-muted">
            <span className="font-medium text-success-fg">{t("report.strengths")}</span> {result.strengths.join(" · ")}
          </p>
        ) : null}
        {stats ? <p className="text-xs text-muted">{t("report.traces", { stats: traceStatsLine(t, stats) })}</p> : null}
        {result.traceNote ? (
          <p className="text-xs text-muted">{stats ? result.traceNote : t("report.tracesUnavailable", { note: result.traceNote })}</p>
        ) : null}
        <p className="text-xs text-dim">{judgedBy.join(" · ")}</p>
      </section>
    </section>
  );
}
