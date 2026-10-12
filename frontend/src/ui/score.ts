/** Score bands on the 0-100 scale, the one rule used app-wide: >= 80 good, >= 60 warn, else bad. */
export type ScoreTone = "good" | "warn" | "bad";

export function scoreTone(score: number): ScoreTone {
  if (score >= 80) return "good";
  if (score >= 60) return "warn";
  return "bad";
}

/** Fill (background) class per band. */
export const SCORE_FILL: Record<ScoreTone, string> = {
  good: "bg-success",
  warn: "bg-evaluator",
  bad: "bg-danger",
};

/** Text class per band, for a score printed in its band's colour. */
export const SCORE_TEXT: Record<ScoreTone, string> = {
  good: "text-success",
  warn: "text-evaluator",
  bad: "text-danger",
};
