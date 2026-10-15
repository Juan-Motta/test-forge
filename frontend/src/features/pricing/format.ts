import type { RunCost } from "./types";

/** Dollars: cents from a dollar up, four decimals below (evaluations often cost cents). */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value < 0.0001) return "<$0.0001";
  return `$${value.toFixed(4)}`;
}

/** The run's approximate total; a trailing "+" when some usage could not be priced. */
export function runCostLabel(cost: RunCost | null | undefined): string {
  if (!cost) return "—";
  return `≈ ${formatUsd(cost.totalUsd)}${cost.complete ? "" : "+"}`;
}

export const PART_LABELS = { caller: "Evaluator", judge: "Judge" } as const;

export const APPROXIMATE_LABEL = "Approximate (OpenAI list prices)";
