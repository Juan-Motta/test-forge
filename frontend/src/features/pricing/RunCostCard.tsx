import { useFormat, useT } from "@/lib/i18n";
import { cn } from "@/ui";
import { PART_LABEL_KEYS, formatUsd, runCostLabel } from "./format";
import type { RunCost } from "./types";

const CARD = "flex flex-col gap-2 rounded-xl border border-line bg-panel p-5";

/**
 * The evaluator's approximate cost of a run: its caller (evaluator) and its judge, the total,
 * a disclosure with the cost of each model, and what an incomplete cost leaves out.
 */
export function RunCostCard({ cost, className }: { cost: RunCost | null | undefined; className?: string }) {
  const t = useT();
  const format = useFormat();
  return (
    <section role="group" aria-label={t("cost.title")} className={cn(CARD, className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="text-[13px] text-muted">{t("cost.title")}</span>
        <span className="text-xs text-dim">{t("cost.approximate")}</span>
      </div>
      {cost ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <span className="font-mono text-2xl font-semibold tabular-nums">{runCostLabel(format, cost)}</span>
            <Amount label={t(PART_LABEL_KEYS.caller)} usd={cost.callerUsd} />
            <Amount label={t(PART_LABEL_KEYS.judge)} usd={cost.judgeUsd} />
          </div>
          {cost.breakdown.length > 0 ? (
            <details className="text-xs text-muted">
              <summary className="w-fit cursor-pointer select-none">{t("cost.byModel")}</summary>
              <ul aria-label={t("cost.byModelLabel")} className="mt-2 flex flex-col gap-1">
                {cost.breakdown.map((line) => (
                  <li key={`${line.part}-${line.model}`} className="flex max-w-md justify-between gap-4">
                    <span>{`${t(PART_LABEL_KEYS[line.part])} · ${line.model}`}</span>
                    <span className="font-mono tabular-nums">{line.usd === null ? t("cost.notPriced") : formatUsd(format, line.usd)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {cost.notes.length > 0 ? (
            <ul aria-label={t("cost.notes")} className="flex flex-col gap-0.5 text-xs text-muted">
              {cost.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <>
          <span className="font-mono text-2xl font-semibold text-muted">—</span>
          <span className="text-xs text-muted">{t("cost.noUsage")}</span>
        </>
      )}
    </section>
  );
}

function Amount({ label, usd }: { label: string; usd: number | null }) {
  const format = useFormat();
  return (
    <span className="flex items-baseline gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums">{formatUsd(format, usd)}</span>
    </span>
  );
}
