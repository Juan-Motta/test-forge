"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { connectLive, type LiveConnectionState } from "@/lib/live/connection";
import { INITIAL_LIVE_STATE, liveReducer } from "./live-state";

export type RunLiveHandlers = {
  onAudio?: (channel: number, pcm: ArrayBuffer) => void;
  /** The caller cut the agent off: fires once per `callerInterrupted` event (snapshots never replay it). */
  onCallerInterrupted?: () => void;
};

const INTERRUPTED = new Set(["callerInterrupted", "caller_interrupted"]);

/**
 * Subscribes to `/api/runs/{id}/live` while mounted: the folded run state, the connection state,
 * each audio frame handed to `onAudio`, and each interruption to `onCallerInterrupted` (handlers
 * are kept in a ref, so changing them never reconnects).
 */
export function useRunLive(runId: string, handlers: RunLiveHandlers = {}) {
  const [state, dispatch] = useReducer(liveReducer, INITIAL_LIVE_STATE);
  const [connection, setConnection] = useState<LiveConnectionState>({ kind: "connecting" });
  const current = useRef(handlers);

  useEffect(() => {
    current.current = handlers;
  });

  useEffect(() => {
    const live = connectLive(`/runs/${encodeURIComponent(runId)}/live`, {
      onMessage: (message) => {
        dispatch({ type: "message", message, now: Date.now() });
        if (INTERRUPTED.has(String(message.type))) current.current.onCallerInterrupted?.();
      },
      onAudio: (channel, pcm) => {
        dispatch({ type: "audio", channel });
        current.current.onAudio?.(channel, pcm);
      },
      onState: setConnection,
    });
    return () => live.close();
  }, [runId]);

  return { state, connection };
}
