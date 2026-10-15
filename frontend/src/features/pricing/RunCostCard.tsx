import { cn } from "@/ui";
import { APPROXIMATE_LABEL, PART_LABELS, formatUsd, runCostLabel } from "./format";
import type { RunCost } from "./types";

const CARD = "flex flex-col gap-2 rounded-xl border border-line bg-panel p-5";

/**
 * The evaluator's approximate cost of a run: its caller (evaluator) and its judge, the total,
 * a disclosure with the cost of each model, and what an incomplete cost leaves out.
 */
export function RunCostCard({ cost, className }: { cost: RunCost | null | undefined; className?: string }) {
  return (
    <section role="group" aria-label="Evaluation cost" className={cn(CARD, className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="text-[13px] text-muted">Evaluation cost</span>
        <span className="text-xs text-dim">{APPROXIMATE_LABEL}</span>
      </div>
      {cost ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <span className="font-mono text-2xl font-semibold tabular-nums">{runCostLabel(cost)}</span>
            <Amount label={PART_LABELS.caller} usd={cost.callerUsd} />
            <Amount label={PART_LABELS.judge} usd={cost.judgeUsd} />
          </div>
          {cost.breakdown.length > 0 ? (
            <details className="text-xs text-muted">
              <summary className="w-fit cursor-pointer select-none">By model</summary>
              <ul aria-label="Cost by model" className="mt-2 flex flex-col gap-1">
                {cost.breakdown.map((line) => (
                  <li key={`${line.part}-${line.model}`} className="flex max-w-md justify-between gap-4">
                    <span>{`${PART_LABELS[line.part]} · ${line.model}`}</span>
                    <span className="font-mono tabular-nums">{line.usd === null ? "not priced" : formatUsd(line.usd)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {cost.notes.length > 0 ? (
            <ul aria-label="Cost notes" className="flex flex-col gap-0.5 text-xs text-muted">
              {cost.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <>
          <span className="font-mono text-2xl font-semibold text-muted">—</span>
          <span className="text-xs text-muted">No usage was recorded for this run.</span>
        </>
      )}
    </section>
  );
}

function Amount({ label, usd }: { label: string; usd: number | null }) {
  return (
    <span className="flex items-baseline gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums">{formatUsd(usd)}</span>
    </span>
  );
}
