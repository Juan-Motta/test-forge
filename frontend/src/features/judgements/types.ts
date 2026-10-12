/** Judgement statuses (judgements/domain.py) plus `none` when the run was never judged. */
export const ACTIVE_JUDGEMENT_STATUSES = ["pending", "collecting_traces", "judging"] as const;
export type ActiveJudgementStatus = (typeof ACTIVE_JUDGEMENT_STATUSES)[number];
export type JudgementStatus = ActiveJudgementStatus | "completed" | "failed";

export type Verdict = "pass" | "partial" | "fail" | "not_observable";
export type EvidenceSource = "transcript" | "trace" | "timing";
export type SuggestionArea = "prompt" | "tools" | "flow" | "latency" | "voice" | "other";
export type SuggestionPriority = "high" | "medium" | "low";

/** Closed failure-tag list (judge/domain.py `FailureTag`); the first four cap the band at 2. */
export const CAPPING_FAILURE_TAGS = [
  "fabricated_information",
  "wrong_information",
  "instruction_ignored",
  "unsafe_or_policy_violation",
] as const;
export type FailureTag =
  | (typeof CAPPING_FAILURE_TAGS)[number]
  | "missing_information_request"
  | "incomplete_task"
  | "off_topic"
  | "unclear_or_unnatural_speech"
  | "cut_off_or_incomplete_reply"
  | "slow_response"
  | "tool_or_trace_error";
export type UnobservableReason =
  | "traces_unavailable"
  | "no_timing_data"
  | "judge_marked_unobservable"
  | "judge_omitted";

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
  /** Judge v2 only: anchored band 1-5 after the cap; null when not observable. */
  band?: number | null;
  /** Judge v2 only. Typed as string so a tag added later still renders. */
  failureTags?: string[];
  /** Judge v2 only: why the criterion was not observable. */
  unobservableReason?: UnobservableReason | null;
  /** Judge v2 only: a capping failure tag lowered the band. */
  capped?: boolean;
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
  /** 2 for judge v2; absent in results stored before it. */
  version?: number;
  summary: string;
  criteria: CriterionResult[];
  /** Weighted over observable criteria; null when none was observable. */
  overallScore: number | null;
  mustFailed: boolean;
  observableWeight: number;
  /** Judge v2 only: tag -> number of criteria carrying it, most frequent first. */
  failureTags?: Record<string, number>;
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
