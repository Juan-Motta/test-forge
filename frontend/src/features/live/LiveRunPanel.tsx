"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { clock, endReasonLabel, isActive, shortId } from "@/features/runs/format";
import { useCancelRun, useRun, runQueryKey } from "@/features/runs/queries";
import { personaLine } from "@/features/runs/RunHeader";
import { RunStatusChip } from "@/features/runs/RunStatusChip";
import { RunTranscript } from "@/features/runs/RunTranscript";
import { errorMessage } from "@/lib/api";
import { createLivePlayer, type Mix } from "@/lib/live/audio";
import type { LiveConnectionState } from "@/lib/live/connection";
import { useNow } from "@/lib/time/use-now";
import { Alert, Button, Card, CardHeader, Spinner, buttonClasses } from "@/ui";
import { ListenControls } from "./ListenControls";
import { TURN_STATE_LABELS } from "./live-state";
import { useRunLive } from "./use-run-live";

const POLL_MS = 3000;
/** How long the "audio skipped" flag stays up after the server's last `lagging` notice. */
const SKIPPED_FLAG_MS = 5000;

/** One run, live: status, timer, listening, turn state, transcript and the evaluator's intent. */
export function LiveRunPanel({ runId }: { runId: string }) {
  const queryClient = useQueryClient();
  const run = useRun(runId, { pollWhileActiveMs: POLL_MS });
  const cancel = useCancelRun();
  const now = useNow(1000);
  const [player] = useState(createLivePlayer);
  const [listening, setListening] = useState(false);
  const [mix, setMix] = useState<Mix>("both");
  const [volume, setVolume] = useState(0.8);
  const { state, connection } = useRunLive(runId, (channel, pcm) => player.push(channel, pcm));

  useEffect(() => () => player.stop(), [player]);

  useEffect(() => {
    // The REST view lags the stream: refresh it as soon as the stream says the run is over.
    if (state.finished) void queryClient.invalidateQueries({ queryKey: runQueryKey(runId) });
  }, [state.finished, queryClient, runId]);

  if (run.isPending) return <Spinner label="Loading run" />;
  if (run.isError) return <Alert title="Could not load the run">{errorMessage(run.error)}</Alert>;

  const data = run.data;
  const status = state.status ?? data.status;
  const active = isActive(status) && !state.finished;
  const endReason = endReasonLabel(state.endReason ?? data.endReason);
  const started = data.startedAt ? Date.parse(data.startedAt) : null;
  const ended = data.endedAt ? Date.parse(data.endedAt) : null;
  const elapsed = started === null ? null : (ended ?? (active ? now : started)) - started;
  const maxS = data.snapshot?.scenario?.endConditions?.maxDurationS;
  const skipped = state.laggingAt !== null && now - state.laggingAt < SKIPPED_FLAG_MS;
  const headingId = `live-run-${runId}`;

  async function listen() {
    player.setMix(mix);
    player.setVolume(volume);
    await player.start();
    setListening(true);
  }

  function stopListening() {
    player.stop();
    setListening(false);
  }

  function chooseMix(next: Mix) {
    setMix(next);
    player.setMix(next);
  }

  function changeVolume(next: number) {
    setVolume(next);
    player.setVolume(next);
  }

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id={headingId} className="text-xl font-semibold">
            {data.scenarioName}
          </h2>
          <p className="text-sm text-muted">
            {[data.agentName, personaLine(data), `thread ${shortId(data.threadId)}`].filter(Boolean).join(" · ")}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <RunStatusChip status={status} />
            {!active && endReason ? <span className="text-muted">{endReason}</span> : null}
            <span className="font-mono text-muted">
              {elapsed === null ? "—" : clock(elapsed)}
              {maxS ? ` / ${clock(maxS * 1000)} max` : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {active ? (
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(runId)}>
              End call
            </Button>
          ) : (
            <Link href={`/runs/${encodeURIComponent(runId)}`} className={buttonClasses("secondary")}>
              Open report
            </Link>
          )}
        </div>
      </div>
      <ConnectionNotice state={connection} />
      {cancel.isError ? <Alert>{`Could not end the call: ${errorMessage(cancel.error)}`}</Alert> : null}
      <ListenControls
        listening={listening}
        disabled={!active}
        onListen={listen}
        onStop={stopListening}
        mix={mix}
        onMix={chooseMix}
        volume={volume}
        onVolume={changeVolume}
        skipped={skipped}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card aria-labelledby={`${headingId}-transcript`}>
          <CardHeader id={`${headingId}-transcript`} title="Live transcript" />
          <RunTranscript live entries={state.entries} emptyText="Nothing said yet." />
        </Card>
        <div className="flex flex-col gap-4">
          <Card aria-labelledby={`${headingId}-turn`} className="gap-2">
            <CardHeader id={`${headingId}-turn`} title="Turn" />
            <p className="text-sm">{TURN_STATE_LABELS[state.finished ? "ended" : state.turnState]}</p>
          </Card>
          <Card aria-labelledby={`${headingId}-intent`} className="gap-2">
            <CardHeader id={`${headingId}-intent`} title="Evaluator intent" />
            {state.decision ? (
              <div className="flex flex-col gap-1.5 text-sm">
                <p className="text-evaluator-fg">
                  {state.decision.say ? `Says: “${state.decision.say}”` : state.decision.hangUp ? "Hangs up" : "Stays silent"}
                </p>
                <p className="text-muted">{state.decision.reason}</p>
              </div>
            ) : (
              <p className="text-sm text-muted">The evaluator has not decided anything yet.</p>
            )}
          </Card>
          {state.warnings.length > 0 ? (
            <Card aria-labelledby={`${headingId}-warnings`} className="gap-2">
              <CardHeader id={`${headingId}-warnings`} title="Warnings" />
              <ul className="flex flex-col gap-1 text-xs text-muted">
                {state.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ConnectionNotice({ state }: { state: LiveConnectionState }) {
  if (state.kind === "error") return <Alert>{state.message}</Alert>;
  if (state.kind === "reconnecting") {
    return (
      <p role="status" className="text-sm text-muted">
        {`Connection lost. Reconnecting in ${Math.round(state.delayMs / 1000)} s (attempt ${state.attempt})…`}
      </p>
    );
  }
  return null;
}
