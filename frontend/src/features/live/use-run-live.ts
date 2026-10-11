"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { connectLive, type LiveConnectionState } from "@/lib/live/connection";
import { INITIAL_LIVE_STATE, liveReducer } from "./live-state";

/**
 * Subscribes to `/api/runs/{id}/live` while mounted: the folded run state, the connection state,
 * and each audio frame handed to `onAudio` (kept in a ref, so changing it never reconnects).
 */
export function useRunLive(runId: string, onAudio?: (channel: number, pcm: ArrayBuffer) => void) {
  const [state, dispatch] = useReducer(liveReducer, INITIAL_LIVE_STATE);
  const [connection, setConnection] = useState<LiveConnectionState>({ kind: "connecting" });
  const audio = useRef(onAudio);

  useEffect(() => {
    audio.current = onAudio;
  });

  useEffect(() => {
    const live = connectLive(`/runs/${encodeURIComponent(runId)}/live`, {
      onMessage: (message) => dispatch({ type: "message", message, now: Date.now() }),
      onAudio: (channel, pcm) => {
        dispatch({ type: "audio", channel });
        audio.current?.(channel, pcm);
      },
      onState: setConnection,
    });
    return () => live.close();
  }, [runId]);

  return { state, connection };
}
