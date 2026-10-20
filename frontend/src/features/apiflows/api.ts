import { apiFetch } from "@/lib/api";
import type { Api, ApiChanges, Flow, NewApi, RevealedSecrets } from "./types";

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
