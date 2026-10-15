import { apiFetch } from "@/lib/api";
import type { Locale } from "@/lib/i18n";
import type { Judgement, JudgementState } from "./types";

const path = (runId: string) => `/runs/${encodeURIComponent(runId)}/judgement`;

/**
 * The run's judgement, or `{status: "none"}` when it was never judged. Its free-text fields come in
 * `lang` once that version is ready (English otherwise; `translationStatus` says which).
 */
export function getJudgement(runId: string, lang: Locale, signal?: AbortSignal): Promise<Judgement> {
  return apiFetch<Judgement>(`${path(runId)}?lang=${lang}`, { signal });
}

/** 202 with the new (pending) judgement. 409 while the run or a judgement of it is in progress. */
export function rejudge(runId: string): Promise<JudgementState> {
  return apiFetch<JudgementState>(path(runId), { method: "POST" });
}

/**
 * Starts translating the completed judgement into `lang` (one small paid chat call); idempotent.
 * 202 with the judgement (translation pending); 409 while judging or with no completed judgement.
 */
export function translateJudgement(runId: string, lang: Locale): Promise<Judgement> {
  return apiFetch<Judgement>(`${path(runId)}/translations?lang=${lang}`, { method: "POST" });
}
