/** "+34 vs previous week" style delta between two counts. */
export function countDelta(current: number, previous: number, period: string) {
  const diff = current - previous;
  if (diff === 0) return { text: `Same as previous ${period}`, trend: "flat" as const };
  return {
    text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs previous ${period}`,
    trend: diff > 0 ? ("up" as const) : ("down" as const),
  };
}

/** Milliseconds as seconds with one decimal ("1.2"). */
export function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

/** A 0..1 share as a whole percentage ("81%"). */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
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
