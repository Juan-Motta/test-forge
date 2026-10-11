/** Judgement statuses (judgements/domain.py) plus `none` when the run was never judged. */
export const ACTIVE_JUDGEMENT_STATUSES = ["pending", "collecting_traces", "judging"] as const;
export type ActiveJudgementStatus = (typeof ACTIVE_JUDGEMENT_STATUSES)[number];
export type JudgementStatus = ActiveJudgementStatus | "completed" | "failed";

export type Verdict = "pass" | "partial" | "fail" | "not_observable";
export type EvidenceSource = "transcript" | "trace" | "timing";
export type SuggestionArea = "prompt" | "tools" | "flow" | "latency" | "voice" | "other";
export type SuggestionPriority = "high" | "medium" | "low";

/** A quote backing a verdict. `ref`: A<n>/C<n> transcript turns, T<n> timings, R<n> traces. */
export type Evidence = { source: EvidenceSource; ref: string; quote: string };

export type CriterionResult = {
  criterionId: string;
  text: string;
  kind: "must" | "should";
  source: EvidenceSource;
  weight: number;
  verdict: Verdict;
  /** 0-100; null when not observable. */
  score: number | null;
  rationale: string;
  evidence: Evidence[];
};

export type Suggestion = {
  title: string;
  detail: string;
  area: SuggestionArea;
  priority: SuggestionPriority;
  evidenceRefs: string[];
};

/** Langfuse digest stats (camelCase); any key may be missing. */
export type TraceStats = {
  traceCount?: number;
  observationCount?: number;
  errorCount?: number;
  warningCount?: number;
  generationCount?: number;
  toolCount?: number;
  models?: string[];
  totalTokens?: number;
  generationLatencyP50Ms?: number | null;
  generationLatencyMaxMs?: number | null;
};

/** `JudgeResult` (judge/domain.py) as stored, camelCase. */
export type JudgeResult = {
  summary: string;
  criteria: CriterionResult[];
  /** Weighted over observable criteria; null when none was observable. */
  overallScore: number | null;
  mustFailed: boolean;
  observableWeight: number;
  suggestions: Suggestion[];
  strengths: string[];
  /** Markdown written for a coding agent. */
  brief: string;
  traceStats: TraceStats | null;
  traceNote: string | null;
  model: string;
};

export type NoJudgement = { status: "none" };

/** `GET /api/runs/{id}/judgement` once the run was handed to the judge. */
export type JudgementState = {
  status: JudgementStatus;
  result: JudgeResult | null;
  traceStats: TraceStats | null;
  traceNote: string | null;
  error: string | null;
  model: string | null;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type Judgement = NoJudgement | JudgementState;
