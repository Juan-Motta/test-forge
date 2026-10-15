import type { Format, MessageKey } from "@/lib/i18n";
import type { CostLine, RunCost } from "./types";

/** Dollars: cents from a dollar up, four decimals below (evaluations often cost cents). */
export function formatUsd(format: Format, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return format.usd(0, 2);
  if (value >= 1) return format.usd(value, 2);
  if (value < 0.0001) return `<${format.usd(0.0001, 4)}`;
  return format.usd(value, 4);
}

/** The run's approximate total; a trailing "+" when some usage could not be priced. */
export function runCostLabel(format: Format, cost: RunCost | null | undefined): string {
  if (!cost) return "—";
  return `≈ ${formatUsd(format, cost.totalUsd)}${cost.complete ? "" : "+"}`;
}

/** The message key naming each costed part of a run. */
export const PART_LABEL_KEYS = {
  caller: "common.evaluator",
  judge: "common.judge",
} as const satisfies Record<CostLine["part"], MessageKey>;
