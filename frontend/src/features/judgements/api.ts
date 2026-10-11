import { apiFetch } from "@/lib/api";
import type { Judgement, JudgementState } from "./types";

const path = (runId: string) => `/runs/${encodeURIComponent(runId)}/judgement`;

/** The run's judgement, or `{status: "none"}` when it was never judged. */
export function getJudgement(runId: string, signal?: AbortSignal): Promise<Judgement> {
  return apiFetch<Judgement>(path(runId), { signal });
}

/** 202 with the new (pending) judgement. 409 while the run or a judgement of it is in progress. */
export function rejudge(runId: string): Promise<JudgementState> {
  return apiFetch<JudgementState>(path(runId), { method: "POST" });
}
