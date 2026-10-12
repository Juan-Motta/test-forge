import { KpiTile } from "@/ui";
import { countDelta, percent, seconds } from "./format";
import type { OverviewStats } from "./types";

/**
 * The four headline metrics of the window; a metric without data reads "—", never 0. While
 * `loading`, the section is marked busy.
 */
export function OverviewKpis({ stats, loading = false }: { stats: OverviewStats | undefined; loading?: boolean }) {
  const period = stats?.periodDays === 7 || !stats ? "week" : `${stats.periodDays} days`;
  const p50 = stats?.latency.p50Ms ?? null;
  const p95 = stats?.latency.p95Ms ?? null;
  return (
    <section
      aria-label="Key metrics"
      aria-busy={loading || undefined}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4"
    >
      <KpiTile
        label={`Runs · last ${stats?.periodDays ?? 7} days`}
        value={stats ? stats.runs.count : "—"}
        delta={stats ? countDelta(stats.runs.count, stats.runs.previousCount, period) : undefined}
      />
      <KpiTile
        label="Average judge score"
        value={stats?.averageScore != null ? stats.averageScore.toFixed(1) : "—"}
        unit="/ 100"
        sub={stats && stats.averageScore === null ? "No judged runs yet" : undefined}
      />
      <KpiTile
        label="Goal completion"
        value={stats?.goalCompletion != null ? percent(stats.goalCompletion) : "—"}
        sub={stats && stats.goalCompletion === null ? "No judged runs yet" : "Must criteria passed"}
      />
      <KpiTile
        label="Agent turn latency · p50"
        value={p50 !== null ? seconds(p50) : "—"}
        unit={p50 !== null ? "s" : undefined}
        sub={p95 !== null ? `p95 ${seconds(p95)} s` : undefined}
      />
    </section>
  );
}
