import { apiFetch } from "@/lib/api";
import type { Connection, ConnectionChanges, DraftConnection, LastTest, NewConnection } from "./types";

const BASE = "/connections";
const item = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export function listConnections(signal?: AbortSignal): Promise<Connection[]> {
  return apiFetch<Connection[]>(BASE, { signal });
}

export function createConnection(input: NewConnection): Promise<Connection> {
  return apiFetch<Connection>(BASE, { method: "POST", body: input });
}

export function updateConnection(id: string, changes: ConnectionChanges): Promise<Connection> {
  return apiFetch<Connection>(item(id), { method: "PATCH", body: changes });
}

export function deleteConnection(id: string): Promise<void> {
  return apiFetch<void>(item(id), { method: "DELETE" });
}

/** Tests the stored credentials; the backend records the result as `lastTest`. */
export function testStoredConnection(id: string): Promise<LastTest> {
  return apiFetch<LastTest>(`${item(id)}/test`, { method: "POST" });
}

/** Tests unsaved values; nothing is stored. */
export function testDraftConnection(draft: DraftConnection): Promise<LastTest> {
  return apiFetch<LastTest>(`${BASE}/test`, { method: "POST", body: draft });
}
