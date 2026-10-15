/** The usage buckets a model is priced on (USD per 1M tokens each). */
export const PRICE_BUCKETS = ["textIn", "cachedTextIn", "audioIn", "cachedAudioIn", "textOut", "audioOut"] as const;
export type PriceBucket = (typeof PRICE_BUCKETS)[number];

/** One model's prices; null means the model has no price for that bucket. */
export type ModelPrice = { model: string } & Partial<Record<PriceBucket, number | null>>;

/** `GET /api/pricing`. */
export type Pricing = {
  currency: string;
  unit: string;
  /** Where the seeded list prices come from, and when they were checked. */
  source: string;
  asOf: string;
  /** Why every cost is approximate. */
  note: string;
  updatedAt: string | null;
  items: ModelPrice[];
};

export type CostLine = { part: "caller" | "judge"; model: string; usd: number | null };

/** The evaluator's approximate cost of a run (`Run.cost`). */
export type RunCost = {
  /** The caller's models (realtime evaluator, or chat + TTS, or chat); null when not recorded. */
  callerUsd: number | null;
  /** The judge, every sample of every attempt; null when not recorded (yet). */
  judgeUsd: number | null;
  totalUsd: number;
  /** False when some usage has no price or could not be metered (TTS audio). */
  complete: boolean;
  notes: string[];
  breakdown: CostLine[];
};
