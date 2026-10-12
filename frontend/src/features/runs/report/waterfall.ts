import type { RunTrace, TraceObservation } from "../types";

/** One waterfall row: its bar's `left` and `width` are percentages of the timeline. */
export type WaterfallRow = TraceObservation & { left: number; width: number; flagged: boolean; note: string };

/** The narrowest bar, so instant observations (events, cached calls) stay visible. */
const MIN_WIDTH = 0.5;
const FLAGGED_LEVELS = new Set(["WARNING", "ERROR"]);

export function isFlagged(observation: Pick<TraceObservation, "level">): boolean {
  return FLAGGED_LEVELS.has(observation.level.toUpperCase());
}

/** "820 tokens", "41.2k tokens". */
export function tokensLabel(tokens: number): string {
  return tokens < 1000 ? `${tokens} tokens` : `${(tokens / 1000).toFixed(1)}k tokens`;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Rows on a timeline from the run start to the end of the run (`durationMs`) or of the last
 * observation, whichever is later. Flagged rows (WARNING, ERROR) note their status message.
 */
export function waterfallRows(observations: readonly TraceObservation[], durationMs: number): WaterfallRow[] {
  const ends = observations.map((item) => (item.startMs ?? 0) + (item.durationMs ?? 0));
  const total = Math.max(durationMs, ...ends, 1);
  return observations.map((item) => {
    const start = Math.min(100, Math.max(0, ((item.startMs ?? 0) / total) * 100));
    const width = round(Math.max(MIN_WIDTH, Math.min(100 - start, ((item.durationMs ?? 0) / total) * 100)));
    // A bar never overflows: one widened to the minimum near the end is pulled back inside.
    const left = round(Math.min(start, 100 - width));
    const flagged = isFlagged(item);
    const note = flagged
      ? (item.statusMessage ?? item.level.toLowerCase())
      : [item.model, item.tokens ? tokensLabel(item.tokens) : null].filter(Boolean).join(" · ");
    return { ...item, left, width, flagged, note };
  });
}

/** "Matched by threadId · 23 observations · 41.2k tokens · $0.084". */
export function traceSummaryLine(trace: RunTrace): string {
  const { observations, stats } = trace;
  const summed = observations.reduce((sum, item) => sum + (item.tokens ?? 0), 0);
  const tokens = typeof stats?.totalTokens === "number" ? stats.totalTokens : summed;
  const cost = observations.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);
  const count = observations.length;
  const parts = ["Matched by threadId", `${count} observation${count === 1 ? "" : "s"}`];
  if (tokens > 0) parts.push(tokensLabel(tokens));
  if (cost > 0) parts.push(`$${cost.toFixed(3)}`);
  return parts.join(" · ");
}
