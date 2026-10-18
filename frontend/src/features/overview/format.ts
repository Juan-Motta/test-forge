import type { Format, Translator } from "@/lib/i18n";

/**
 * "+34 vs previous week" style delta between two counts, over a window of `days` (7 reads as a
 * week).
 */
export function countDelta(t: Translator, current: number, previous: number, days: number) {
  const diff = current - previous;
  const period = days === 7 ? t("overview.week") : t("overview.days", { count: days });
  if (diff === 0) return { text: t("overview.sameAsPrevious", { period }), trend: "flat" as const };
  return {
    text: t("overview.vsPrevious", { diff: `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`, period }),
    trend: diff > 0 ? ("up" as const) : ("down" as const),
  };
}

/** "+$0.73 vs previous week" style delta between two amounts; spending more is not an improvement. */
export function spendDelta(t: Translator, format: Format, current: number, previous: number | null, days: number) {
  const period = days === 7 ? t("overview.week") : t("overview.days", { count: days });
  const diff = current - (previous ?? 0);
  if (Math.abs(diff) < 0.005) {
    return { text: t("overview.sameAsPrevious", { period }), trend: "flat" as const, goodWhen: "down" as const };
  }
  return {
    text: t("overview.vsPrevious", { diff: `${diff > 0 ? "+" : "−"}${format.usd(Math.abs(diff), 2)}`, period }),
    trend: diff > 0 ? ("up" as const) : ("down" as const),
    goodWhen: "down" as const,
  };
}

/** Milliseconds as seconds with one decimal ("1.2"), in the page's notation. */
export function seconds(format: Format, ms: number): string {
  return format.number(ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** A 0..1 share as a whole percentage ("81%"), in the page's notation. */
export function percent(format: Format, share: number): string {
  return format.number(share, { style: "percent", maximumFractionDigits: 0 });
}

/**
 * Deterministic waveform for a call whose live levels are not available here: 48 bars shaped by
 * the run id, alternating speaker blocks (a placeholder, not audio).
 */
export function placeholderWave(seed: string, bars = 48) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const phase = (hash % 1000) / 100;
  const pattern = ["agent", "agent", "evaluator", "silent", "agent", "evaluator"] as const;
  const shift = hash % pattern.length;
  const values: number[] = [];
  const tones: (typeof pattern)[number][] = [];
  for (let index = 0; index < bars; index += 1) {
    values.push(Math.abs(Math.sin(index * 0.55 + phase) * 0.6 + Math.sin(index * 1.7 + phase * 2) * 0.4));
    tones.push(pattern[(Math.floor(index / 8) + shift) % pattern.length]);
  }
  return { values, tones };
}
