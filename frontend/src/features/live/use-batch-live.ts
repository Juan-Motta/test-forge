"use client";

import { useEffect, useReducer, useState } from "react";
import type { Run, RunStatus } from "@/features/runs/types";
import { connectLive, type LiveConnectionState } from "@/lib/live/connection";

export type BatchLiveState = {
  batch: { id: string; status: string; total: number } | null;
  runs: Run[];
  finished: boolean;
};

type Action = { message: Record<string, unknown>; now: number };

const INITIAL: BatchLiveState = { batch: null, runs: [], finished: false };

/** Folds the batch overview stream: a `snapshot` of the runs, then their `status`/`finished`. */
export function batchLiveReducer(state: BatchLiveState, { message, now }: Action): BatchLiveState {
  const patch = (runId: unknown, changes: (run: Run) => Partial<Run>) => ({
    ...state,
    runs: state.runs.map((run) => (run.id === runId ? { ...run, ...changes(run) } : run)),
  });
  switch (message.type) {
    case "snapshot":
      return {
        batch: (message.batch as BatchLiveState["batch"]) ?? null,
        runs: Array.isArray(message.runs) ? (message.runs as Run[]) : [],
        finished: false,
      };
    case "status":
      return patch(message.runId, (run) => ({
        status: message.status as RunStatus,
        // The overview does not carry timestamps: start the timer when the run leaves the queue.
        startedAt: run.startedAt ?? new Date(now).toISOString(),
      }));
    case "finished":
      return patch(message.runId, (run) => ({
        status: message.status as RunStatus,
        endReason: (message.reason as string | null) ?? null,
        endedAt: run.endedAt ?? new Date(now).toISOString(),
      }));
    case "batchFinished":
      return { ...state, finished: true };
    default:
      return state;
  }
}

/** Subscribes to `/api/runs/live?batchId=` while `batchId` is set. */
export function useBatchLive(batchId: string | undefined) {
  const [state, dispatch] = useReducer(batchLiveReducer, INITIAL);
  const [connection, setConnection] = useState<LiveConnectionState>({ kind: "connecting" });

  useEffect(() => {
    if (!batchId) return;
    const live = connectLive(
      `/runs/live?batchId=${encodeURIComponent(batchId)}`,
      { onMessage: (message) => dispatch({ message, now: Date.now() }), onState: setConnection },
      "This batch does not exist.",
    );
    return () => live.close();
  }, [batchId]);

  return { state, connection };
}
