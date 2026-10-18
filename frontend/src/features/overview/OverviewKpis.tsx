import { useFormat, useT } from "@/lib/i18n";
import { ClockIcon, KpiTile, PriceIcon, RunsIcon, StarIcon, TargetIcon } from "@/ui";
import { countDelta, percent, seconds, spendDelta } from "./format";
import type { OverviewStats } from "./types";

/**
 * The headline metrics of the window, each with an icon; a metric without data reads "—", never 0. While
 * `loading`, the section is marked busy.
 */
export function OverviewKpis({ stats, loading = false }: { stats: OverviewStats | undefined; loading?: boolean }) {
  const t = useT();
  const format = useFormat();
  const days = stats?.periodDays ?? 7;
  const oneDecimal = (value: number) => format.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const p50 = stats?.latency.p50Ms ?? null;
  const p95 = stats?.latency.p95Ms ?? null;
  const spend = stats?.spend.totalUsd ?? null;
  const icon = { size: 16, "data-kpi-icon": true } as const;
  return (
    <section
      aria-label={t("overview.keyMetrics")}
      aria-busy={loading || undefined}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-4"
    >
      <KpiTile
        icon={<RunsIcon {...icon} />}
        label={t("overview.runsLastDays", { count: days })}
        value={stats ? stats.runs.count : "—"}
        delta={stats ? countDelta(t, stats.runs.count, stats.runs.previousCount, days) : undefined}
      />
      <KpiTile
        icon={<StarIcon {...icon} />}
        label={t("overview.averageScore")}
        value={stats?.averageScore != null ? oneDecimal(stats.averageScore) : "—"}
        unit="/ 100"
        sub={stats && stats.averageScore === null ? t("overview.noJudged") : undefined}
      />
      <KpiTile
        icon={<TargetIcon {...icon} />}
        label={t("overview.goalCompletion")}
        value={stats?.goalCompletion != null ? percent(format, stats.goalCompletion) : "—"}
        sub={stats && stats.goalCompletion === null ? t("overview.noJudged") : t("overview.mustPassed")}
      />
      <KpiTile
        icon={<ClockIcon {...icon} />}
        label={t("overview.latency")}
        value={p50 !== null ? seconds(format, p50) : "—"}
        unit={p50 !== null ? "s" : undefined}
        sub={p95 !== null ? `p95 ${seconds(format, p95)} s` : undefined}
      />
      <KpiTile
        icon={<PriceIcon {...icon} />}
        label={t("overview.spendLastDays", { count: days })}
        value={spend !== null ? `${format.usd(spend, 2)}${stats?.spend.complete === false ? "+" : ""}` : "—"}
        delta={
          // No comparison against a window that recorded no usage (it would read as all new spend).
          stats && spend !== null && stats.spend.previousTotalUsd !== null
            ? spendDelta(t, format, spend, stats.spend.previousTotalUsd, days)
            : undefined
        }
        sub={spend !== null ? t("overview.spendNote") : stats ? t("overview.noSpend") : undefined}
      />
    </section>
  );
}
