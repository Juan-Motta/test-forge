/** One of the lowest-scoring criteria of the window (`weakestCriteria`). */
export type WeakCriterion = {
  text: string;
  scenarioName: string;
  /** Average judge score, 0-100 with one decimal. */
  averageScore: number;
  /** How many judged runs scored it. */
  judged: number;
};

/** `GET /api/stats/overview?days=N`: aggregates over the runs created in the last N days. */
export type OverviewStats = {
  periodDays: number;
  runs: { count: number; previousCount: number };
  /** 0-100 with one decimal; null without completed judgements. */
  averageScore: number | null;
  /** Share 0..1 of completed judgements whose must criteria passed; null without any. */
  goalCompletion: number | null;
  latency: { p50Ms: number | null; p95Ms: number | null };
  live: { active: number };
  /** Lowest average first, at most 5. */
  weakestCriteria: WeakCriterion[];
  suggestions: { open: number; highPriority: number };
};
