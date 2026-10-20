import { apiFetch } from "@/lib/api";
import type { FlowPayload } from "./flow-draft";
import type { Api, ApiChanges, Flow, FlowCurls, FlowRun, NewApi, RevealedSecrets, RunInputs } from "./types";

const APIS = "/apis";
const api = (id: string) => `${APIS}/${encodeURIComponent(id)}`;

/** Every API with its flow count and the agents of its flows; secrets come masked. */
export function listApis(signal?: AbortSignal): Promise<Api[]> {
  return apiFetch<Api[]>(APIS, { signal });
}

export function getApi(id: string, signal?: AbortSignal): Promise<Api> {
  return apiFetch<Api>(api(id), { signal });
}

export function createApi(input: NewApi): Promise<Api> {
  return apiFetch<Api>(APIS, { method: "POST", body: input });
}

export function updateApi(id: string, changes: ApiChanges): Promise<Api> {
  return apiFetch<Api>(api(id), { method: "PATCH", body: changes });
}

/** Refused (409) while the API holds flows. */
export function deleteApi(id: string): Promise<void> {
  return apiFetch<void>(api(id), { method: "DELETE" });
}

/** The API's secrets in clear. Asked only when the user reveals one; never cached. */
export function revealSecrets(id: string): Promise<RevealedSecrets> {
  return apiFetch<RevealedSecrets>(`${api(id)}/secrets`);
}

/** The flows of one API (or every flow without `apiId`). */
export function listFlows(filters: { apiId?: string } = {}, signal?: AbortSignal): Promise<Flow[]> {
  const query = filters.apiId ? `?apiId=${encodeURIComponent(filters.apiId)}` : "";
  return apiFetch<Flow[]>(`/flows${query}`, { signal });
}

const flow = (id: string) => `/flows/${encodeURIComponent(id)}`;

/** 409 when the name is taken within the API; 422 with a location per wrong field. */
export function createFlow(input: FlowPayload & { apiId: string }): Promise<Flow> {
  return apiFetch<Flow>("/flows", { method: "POST", body: input });
}

export function updateFlow(id: string, changes: Partial<FlowPayload>): Promise<Flow> {
  return apiFetch<Flow>(flow(id), { method: "PATCH", body: changes });
}

export function deleteFlow(id: string): Promise<void> {
  return apiFetch<void>(flow(id), { method: "DELETE" });
}

/** One cURL per step of the saved flow, with the API's secrets masked. */
export function flowCurls(id: string): Promise<FlowCurls> {
  return apiFetch<FlowCurls>(`${flow(id)}/curl`);
}

/** Runs the flow now (it may take minutes); 422 names a wrong input, 502 when AI could not write one. */
export function runFlow(id: string, inputs: RunInputs): Promise<FlowRun> {
  return apiFetch<FlowRun>(`${flow(id)}/runs`, { method: "POST", body: { inputs } });
}

/** The flow's latest runs, newest first. */
export function listFlowRuns(id: string, limit: number, signal?: AbortSignal): Promise<FlowRun[]> {
  return apiFetch<FlowRun[]>(`${flow(id)}/runs?limit=${limit}`, { signal });
}

export function getFlowRun(id: string, signal?: AbortSignal): Promise<FlowRun> {
  return apiFetch<FlowRun>(`/flow-runs/${encodeURIComponent(id)}`, { signal });
}

/** The cURL of one step as it was sent: masked, or with the secrets in clear when `reveal`. */
export function stepCurl(runId: string, index: number, reveal: boolean): Promise<{ curl: string }> {
  const query = reveal ? "?reveal=true" : "";
  return apiFetch<{ curl: string }>(`/flow-runs/${encodeURIComponent(runId)}/steps/${index}/curl${query}`);
}
