"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { clock, endReasonLabel, isActive, latency, shortId } from "@/features/runs/format";
import { useCancelRun, useRun, runQueryKey } from "@/features/runs/queries";
import { ChatTranscript } from "@/features/runs/ChatTranscript";
import { runKind, textModeLabel } from "@/features/runs/kind";
import { personaLine } from "@/features/runs/RunHeader";
import { RunStatusChip } from "@/features/runs/RunStatusChip";
import { interruptedAt } from "@/features/runs/transcript";
import { errorMessage } from "@/lib/api";
import { AGENT_CHANNEL, createLivePlayer, type Mix } from "@/lib/live/audio";
import type { LiveConnectionState } from "@/lib/live/connection";
import { createLevelMeter, type LevelMeter } from "@/lib/live/levels";
import { useNow } from "@/lib/time/use-now";
import { Alert, Badge, Button, KpiTile, LiveDot, Spinner, buttonClasses, cn } from "@/ui";
import { ListenControls } from "./ListenControls";
import { LiveLanes } from "./LiveLanes";
import { LiveTranscript } from "./LiveTranscript";
import { confirmationLabel, turnStateLabel } from "./live-state";
import { SLOW_TURN_MS, evaluatorChip, evaluatorGoals, liveMetrics, type SessionStats } from "./live-view";
import { useRunLive } from "./use-run-live";

const POLL_MS = 3000;
/** How long the "audio skipped" flag stays up after the server's last `lagging` notice. */
const SKIPPED_FLAG_MS = 5000;

type LiveRunPanelProps = {
  runId: string;
  /** Where the audio levels go (the page shares it with the session card); a private one otherwise. */
  meter?: LevelMeter;
  /** Turns and median latency so far, each time they change. */
  onStats?: (stats: SessionStats) => void;
};

/**
 * One run, live: timer, listening, audio lanes, transcript, the evaluator's plan and the call
 * metrics. A text run has no audio: its chat streams in, with reply timings and tools.
 */
export function LiveRunPanel({ runId, meter: sharedMeter, onStats }: LiveRunPanelProps) {
  const queryClient = useQueryClient();
  const run = useRun(runId, { pollWhileActiveMs: POLL_MS });
  const cancel = useCancelRun();
  const now = useNow(1000);
  const [player] = useState(createLivePlayer);
  const [ownMeter] = useState(createLevelMeter);
  const meter = sharedMeter ?? ownMeter;
  const [listening, setListening] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [mix, setMix] = useState<Mix>("both");
  const [volume, setVolume] = useState(0.8);
  const { state, connection } = useRunLive(runId, {
    onAudio: (channel, pcm) => {
      // Levels are measured whether or not anyone listens.
      meter.push(channel, pcm, Date.now());
      player.push(channel, pcm);
    },
    // The agent's reply arrives faster than real time: drop the part the caller cut off.
    onCallerInterrupted: () => {
      meter.cut(AGENT_CHANNEL, Date.now());
      player.cut(AGENT_CHANNEL);
    },
  });
  const metrics = liveMetrics(state);
  const statsHandler = useRef(onStats);

  useEffect(() => {
    statsHandler.current = onStats;
  });

  useEffect(() => {
    statsHandler.current?.({ turns: metrics.turns, p50Ms: metrics.p50Ms });
  }, [metrics.turns, metrics.p50Ms]);

  // Next keeps visited pages mounted but hidden (<Activity>): stop the audio when this panel is
  // hidden or unmounted, and come back not listening.
  useLayoutEffect(
    () => () => {
      player.stop();
      setListening(false);
    },
    [player],
  );

  useEffect(() => {
    // The REST view lags the stream: refresh it as soon as the stream says the run is over.
    if (state.finished) void queryClient.invalidateQueries({ queryKey: runQueryKey(runId) });
  }, [state.finished, queryClient, runId]);

  if (run.isPending) return <Spinner label="Loading run" />;
  if (run.isError) return <Alert title="Could not load the run">{errorMessage(run.error)}</Alert>;

  const data = run.data;
  const status = state.status ?? data.status;
  const active = isActive(status) && !state.finished;
  const kind = runKind(data);
  const text = kind === "text";
  const endReason = endReasonLabel(state.endReason ?? data.endReason, kind);
  const started = data.startedAt ? Date.parse(data.startedAt) : null;
  const ended = data.endedAt ? Date.parse(data.endedAt) : null;
  const elapsed = started === null ? null : (ended ?? (active ? now : started)) - started;
  const maxS = data.snapshot?.scenario?.endConditions?.maxDurationS;
  const skipped = state.laggingAt !== null && now - state.laggingAt < SKIPPED_FLAG_MS;
  const evaluator = text ? ["Text agent", textModeLabel(data)].filter(Boolean).join(" · ") : evaluatorChip(data.snapshot);
  const toolsUsed = state.entries.reduce((sum, entry) => sum + (entry.tools?.length ?? 0), 0);
  const goals = evaluatorGoals(data.snapshot);
  const headingId = `live-run-${runId}`;

  async function listen() {
    player.setMix(mix);
    player.setVolume(volume);
    setAudioError(null);
    try {
      await player.start();
    } catch (error) {
      setAudioError(error instanceof Error && error.message ? error.message : "The browser refused to play audio.");
      return;
    }
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
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-[18px] rounded-xl border border-line bg-panel p-4 sm:p-[22px]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            {active ? <LiveDot label="Live" /> : null}
            <h2 id={headingId} className="text-xl font-semibold">
              {data.scenarioName}
            </h2>
          </div>
          <p className="text-[13px] text-muted">
            {[data.agentName, personaLine(data)].filter(Boolean).join(" · ")}
            {" · thread "}
            <span className="font-mono text-fg/85">{shortId(data.threadId)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <RunStatusChip status={status} />
            {evaluator ? <Badge tone="muted">{evaluator}</Badge> : null}
            <span className="text-muted">{turnStateLabel(state.finished ? "ended" : state.turnState, kind)}</span>
            {!active && endReason ? <span className="text-muted">{endReason}</span> : null}
          </div>
        </div>
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-[22px] font-medium tabular-nums">{elapsed === null ? "—" : clock(elapsed)}</span>
          {maxS ? <span className="text-xs text-dim">{`/ ${clock(maxS * 1000)} max`}</span> : null}
        </div>
      </div>
      <ConnectionNotice state={connection} />
      {cancel.isError ? (
        <Alert>{`Could not end the ${text ? "conversation" : "call"}: ${errorMessage(cancel.error)}`}</Alert>
      ) : null}
      {audioError ? <Alert title="Could not start the audio">{audioError}</Alert> : null}
      {text ? null : (
        <>
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
          <LiveLanes meter={meter} active={active} startedMs={started} endedMs={ended} />
        </>
      )}
      <div className="flex flex-wrap items-start gap-[18px]">
        <div className="flex min-w-0 flex-[999_1_380px] flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{text ? "Live conversation" : "Live transcript"}</h3>
          </div>
          {text ? (
            <ChatTranscript live entries={state.entries} emptyText="No messages yet." pending={state.pending} />
          ) : (
            <LiveTranscript entries={state.entries} pending={state.pending} />
          )}
          {state.interruptions.length > 0 ? (
            <ul aria-label="Caller interruptions" className="flex flex-col gap-0.5 text-xs text-dim">
              {state.interruptions.map((interruption, index) => (
                <li key={index}>
                  {`Caller interrupted agent reply #${interruption.agentTurn ?? "?"} ${interruptedAt(interruption.audioEndMs)} · ≈ heard “${interruption.heardText}” · ${confirmationLabel(interruption, state.finished)}`}
                </li>
              ))}
            </ul>
          ) : null}
          {state.bargeIns.length > 0 ? (
            <ul aria-label="Barge-ins" className="flex flex-col gap-0.5 text-xs text-dim">
              {state.bargeIns.map((bargeIn, index) => (
                <li key={index}>{`Agent talked over the evaluator · ${bargeIn.tMs === null ? "—" : clock(bargeIn.tMs)}`}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3.5">
            {active ? (
              <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(runId)}>
                {text ? "End conversation" : "End call"}
              </Button>
            ) : (
              <Link href={`/runs/${encodeURIComponent(runId)}`} className={buttonClasses("secondary")}>
                Open report
              </Link>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-4">
          <RailBox
            id={`${headingId}-goals`}
            title="Evaluator goals"
            note={`The plan; the judge checks it after the ${text ? "conversation" : "call"}.`}
          >
            {goals.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {goals.map((goal, index) => (
                  <li key={index} className="flex items-start gap-2 text-[13px] text-muted">
                    <span aria-hidden="true" className="mt-0.5 size-4 shrink-0 rounded-full border-[1.5px] border-idle" />
                    {goal}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">This run carries no goals.</p>
            )}
          </RailBox>
          <section aria-labelledby={`${headingId}-metrics`} className="flex flex-col gap-2.5">
            <h3 id={`${headingId}-metrics`} className="sr-only">
              {text ? "Conversation metrics" : "Call metrics"}
            </h3>
            {text ? (
              <div className="grid grid-cols-2 gap-2.5">
                <Metric label="Avg time to first text" ms={metrics.avgLatencyMs} />
                <Metric label="Slowest first text" ms={metrics.slowestMs} flagSlow />
                <KpiTile className={TILE} label="Messages" value={metrics.turns} />
                <KpiTile className={TILE} label="Tools used" value={toolsUsed} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <Metric label="Avg agent latency" ms={metrics.avgLatencyMs} />
                <Metric label="Slowest turn" ms={metrics.slowestMs} flagSlow />
                <KpiTile className={TILE} label="Turns" value={metrics.turns} />
                <KpiTile
                  className={TILE}
                  label="Interruptions"
                  value={metrics.interruptions}
                  sub={metrics.interruptions > 0 ? `${metrics.confirmed} confirmed` : undefined}
                />
              </div>
            )}
          </section>
          <RailBox id={`${headingId}-intent`} title="Evaluator intent">
            {state.decision ? (
              <div className="flex flex-col gap-1.5 text-sm">
                <p className="text-evaluator-fg">
                  {state.decision.discarded ? "Discarded (the agent spoke again first): " : ""}
                  {state.decision.say
                    ? `${text ? "Sends" : "Says"}: “${state.decision.say}”`
                    : state.decision.hangUp
                      ? text
                        ? "Ends the conversation"
                        : "Hangs up"
                      : "Stays silent"}
                </p>
                <p className="text-muted">{state.decision.reason}</p>
              </div>
            ) : (
              <p className="text-sm text-muted">The evaluator has not decided anything yet.</p>
            )}
          </RailBox>
          {state.warnings.length > 0 ? (
            <RailBox id={`${headingId}-warnings`} title="Warnings">
              <ul className="flex flex-col gap-1 text-xs text-muted">
                {state.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </RailBox>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const TILE = "gap-1.5 rounded-[10px] bg-raised px-3.5 py-3";

/** A latency tile: number and unit apart ("1.4" "s"), red past the slow threshold when asked. */
function Metric({ label, ms, flagSlow = false }: { label: string; ms: number | null; flagSlow?: boolean }) {
  if (ms === null) return <KpiTile className={TILE} label={label} value="—" />;
  const [value, unit] = latency(ms).split(" ");
  const slow = flagSlow && ms > SLOW_TURN_MS;
  return (
    <KpiTile
      className={TILE}
      label={label}
      value={<span className={cn(slow && "text-danger-fg")}>{value}</span>}
      unit={unit}
      sub={slow ? "Slow" : undefined}
    />
  );
}

function RailBox({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-raised p-3.5">
      <div className="flex flex-col gap-0.5">
        <h3 id={id} className="text-[13px] font-semibold">
          {title}
        </h3>
        {note ? <p className="text-xs text-dim">{note}</p> : null}
      </div>
      {children}
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
