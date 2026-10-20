import type { FlowRunSummary } from "@/features/apiflows/types";
import type { Run } from "./types";

/** One row of the runs page when it lists API flow runs: an agent run or a flow run. */
export type RunEntry = { kind: "agent"; run: Run } | { kind: "flow"; run: FlowRunSummary };

/** How many of each kind the "All" view reads at most: its newest runs of each. */
export const MERGE_CAP = 200;

/** Agent runs and flow runs together, newest first (agent runs first on a tie). */
export function mergeRuns(agentRuns: Run[], flowRuns: FlowRunSummary[]): RunEntry[] {
  const entries: RunEntry[] = [
    ...agentRuns.map((run) => ({ kind: "agent" as const, run })),
    ...flowRuns.map((run) => ({ kind: "flow" as const, run })),
  ];
  // A stable sort keeps each kind's own order on equal times.
  // Compared as instants: ISO strings with and without fractions do not sort as text.
  return entries.sort((a, b) => Date.parse(b.run.createdAt) - Date.parse(a.run.createdAt));
}

/** Where a flow run opens: its run view inside the API. */
export function flowRunHref(run: Pick<FlowRunSummary, "id" | "apiId" | "flowId">): string {
  return `/apis/${encodeURIComponent(run.apiId)}?flow=${encodeURIComponent(run.flowId)}&run=${encodeURIComponent(run.id)}`;
}
