import { useFormat, useT } from "@/lib/i18n";
import { KpiTile } from "@/ui";
import { countDelta, percent, seconds } from "./format";
import type { OverviewStats } from "./types";

/**
 * The four headline metrics of the window; a metric without data reads "—", never 0. While
 * `loading`, the section is marked busy.
 */
export function OverviewKpis({ stats, loading = false }: { stats: OverviewStats | undefined; loading?: boolean }) {
  const t = useT();
  const format = useFormat();
  const days = stats?.periodDays ?? 7;
  const oneDecimal = (value: number) => format.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const p50 = stats?.latency.p50Ms ?? null;
  const p95 = stats?.latency.p95Ms ?? null;
  return (
    <section
      aria-label={t("overview.keyMetrics")}
      aria-busy={loading || undefined}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4"
    >
      <KpiTile
        label={t("overview.runsLastDays", { count: days })}
        value={stats ? stats.runs.count : "—"}
        delta={stats ? countDelta(t, stats.runs.count, stats.runs.previousCount, days) : undefined}
      />
      <KpiTile
        label={t("overview.averageScore")}
        value={stats?.averageScore != null ? oneDecimal(stats.averageScore) : "—"}
        unit="/ 100"
        sub={stats && stats.averageScore === null ? t("overview.noJudged") : undefined}
      />
      <KpiTile
        label={t("overview.goalCompletion")}
        value={stats?.goalCompletion != null ? percent(format, stats.goalCompletion) : "—"}
        sub={stats && stats.goalCompletion === null ? t("overview.noJudged") : t("overview.mustPassed")}
      />
      <KpiTile
        label={t("overview.latency")}
        value={p50 !== null ? seconds(format, p50) : "—"}
        unit={p50 !== null ? "s" : undefined}
        sub={p95 !== null ? `p95 ${seconds(format, p95)} s` : undefined}
      />
    </section>
  );
}
