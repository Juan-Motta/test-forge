import { apiFetch } from "@/lib/api";
import type {
  AudioChannel,
  BatchDetail,
  BatchPage,
  LaunchInput,
  Run,
  RunDetail,
  RunFilters,
  RunPage,
} from "./types";

const BASE = "/runs";
const item = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Creates a batch (one queued run per scenario and repetition) and starts it. 422: not runnable. */
export function launchRuns(input: LaunchInput): Promise<BatchDetail> {
  return apiFetch<BatchDetail>(BASE, { method: "POST", body: input });
}

/** Runs, newest first. */
export function listRuns(filters: RunFilters = {}, signal?: AbortSignal): Promise<RunPage> {
  return apiFetch<RunPage>(`${BASE}${query(filters)}`, { signal });
}

export function getRun(id: string, signal?: AbortSignal): Promise<RunDetail> {
  return apiFetch<RunDetail>(item(id), { signal });
}

/** 202; the run becomes `cancelled` once its session is closed. 409 when it is already over. */
export function cancelRun(id: string): Promise<Run> {
  return apiFetch<Run>(`${item(id)}/cancel`, { method: "POST" });
}

export function listBatches(
  page: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<BatchPage> {
  return apiFetch<BatchPage>(`${BASE}/batches${query(page)}`, { signal });
}

export function getBatch(id: string, signal?: AbortSignal): Promise<BatchDetail> {
  return apiFetch<BatchDetail>(`${BASE}/batches/${encodeURIComponent(id)}`, { signal });
}

export function cancelBatch(id: string): Promise<BatchDetail> {
  return apiFetch<BatchDetail>(`${BASE}/batches/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

/** Same-origin URL of one side's WAV (`audio/wav`, PCM16 24 kHz mono); the cookie authenticates it. */
export function audioUrl(id: string, channel: AudioChannel): string {
  return `/api${item(id)}/audio/${channel}`;
}
