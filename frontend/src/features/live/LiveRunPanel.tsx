"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { clock, endReasonLabel, isActive, latency } from "@/features/runs/format";
import { useCancelRun, useRun, runQueryKey } from "@/features/runs/queries";
import { ChatTranscript } from "@/features/runs/ChatTranscript";
import { runKind, textModeLabel } from "@/features/runs/kind";
import { personaLine } from "@/features/runs/RunHeader";
import { RunStatusChip } from "@/features/runs/RunStatusChip";
import { callerIntent, interruptedAt } from "@/features/runs/transcript";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { AGENT_CHANNEL, createLivePlayer, type Mix } from "@/lib/live/audio";
import type { LiveConnectionState } from "@/lib/live/connection";
import { createLevelMeter, type LevelMeter } from "@/lib/live/levels";
import { useNow } from "@/lib/time/use-now";
import { Alert, Badge, Button, CopyButton, KpiTile, LiveDot, Spinner, buttonClasses, cn } from "@/ui";
import { ListenControls } from "./ListenControls";
import { LiveLanes } from "./LiveLanes";
import { LiveTranscript } from "./LiveTranscript";
import { confirmationLabel, turnStateLabel } from "./live-state";
import {
  SLOW_TURN_MS,
  evaluatorChip,
  evaluatorGoals,
  liveConnectionError,
  liveMetrics,
  type SessionStats,
} from "./live-view";
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
  /**
   * Start listening without a click on Listen (a call in progress only): one attempt each time it
   * turns on, never a retry loop. When the browser refuses, the panel asks for a click instead.
   */
  autoListen?: boolean;
};

/**
 * One run, live: timer, listening, audio lanes, transcript, the evaluator's plan and the call
 * metrics. A text run has no audio: its chat streams in, with reply timings and tools.
 */
export function LiveRunPanel({ runId, meter: sharedMeter, onStats, autoListen = false }: LiveRunPanelProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const run = useRun(runId, { pollWhileActiveMs: POLL_MS });
  const cancel = useCancelRun();
  const now = useNow(1000);
  const [player] = useState(createLivePlayer);
  const [ownMeter] = useState(createLevelMeter);
  const meter = sharedMeter ?? ownMeter;
  const [listening, setListening] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  /** An automatic start was refused (or could not be tried): the browser needs a click first. */
  const [needsClick, setNeedsClick] = useState(false);
  const autoTried = useRef(false);
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

  const canAutoListen =
    run.data !== undefined && runKind(run.data) !== "text" && isActive(state.status ?? run.data.status) && !state.finished;

  const startAutomatically = useEffectEvent(() => {
    if (autoTried.current || player.started) return;
    autoTried.current = true;
    void listen(true);
  });

  useEffect(() => {
    // Off resets the attempt: switching it on again (a click) may start the audio.
    if (!autoListen) autoTried.current = false;
    else if (canAutoListen) startAutomatically();
  }, [autoListen, canAutoListen]);

  useEffect(() => {
    // The REST view lags the stream: refresh it as soon as the stream says the run is over.
    if (state.finished) void queryClient.invalidateQueries({ queryKey: runQueryKey(runId) });
  }, [state.finished, queryClient, runId]);

  if (run.isPending) return <Spinner label={t("runs.loadingOne")} />;
  if (run.isError) return <Alert title={t("runs.loadOneFailed")}>{errorMessage(run.error)}</Alert>;

  const data = run.data;
  const status = state.status ?? data.status;
  const active = isActive(status) && !state.finished;
  const kind = runKind(data);
  const text = kind === "text";
  const endReason = endReasonLabel(t, state.endReason ?? data.endReason, kind);
  const started = data.startedAt ? Date.parse(data.startedAt) : null;
  const ended = data.endedAt ? Date.parse(data.endedAt) : null;
  const elapsed = started === null ? null : (ended ?? (active ? now : started)) - started;
  const maxS = data.snapshot?.scenario?.endConditions?.maxDurationS;
  const skipped = state.laggingAt !== null && now - state.laggingAt < SKIPPED_FLAG_MS;
  const evaluator = text
    ? [t("runs.textAgent"), textModeLabel(t, data)].filter(Boolean).join(" · ")
    : evaluatorChip(t, data.snapshot);
  const toolsUsed = state.entries.reduce((sum, entry) => sum + (entry.tools?.length ?? 0), 0);
  const goals = evaluatorGoals(data.snapshot);
  const headingId = `live-run-${runId}`;

  async function listen(automatic = false) {
    player.setMix(mix);
    player.setVolume(volume);
    setAudioError(null);
    setNeedsClick(false);
    try {
      // Without any click on the page yet, browsers keep the audio suspended: ask for one instead.
      if (automatic && !hasUserGesture()) throw new Error(t("live.needsGesture"));
      await player.start();
    } catch (error) {
      setAudioError(error instanceof Error && error.message ? error.message : t("live.audioRefused"));
      if (automatic) setNeedsClick(true);
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
            {active ? <LiveDot label={t("runs.live")} /> : null}
            <h2 id={headingId} className="text-xl font-semibold">
              {data.scenarioName}
            </h2>
          </div>
          <p className="text-[13px] text-muted">{[data.agentName, personaLine(data)].filter(Boolean).join(" · ")}</p>
          <p className="flex min-w-0 items-center gap-1 text-[13px] text-muted">
            <span>{t("live.thread")}</span>
            <span className="min-w-0 font-mono break-all text-fg/85">{data.threadId}</span>
            <CopyButton
              text={data.threadId}
              label={t("runs.copyThreadId")}
              copiedMessage={t("runs.threadIdCopied")}
              iconSize={13}
              className="size-7 min-h-0 min-w-0"
            />
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <RunStatusChip status={status} />
            {evaluator ? <Badge tone="muted">{evaluator}</Badge> : null}
            <span className="text-muted">{turnStateLabel(t, state.finished ? "ended" : state.turnState, kind)}</span>
            {!active && endReason ? <span className="text-muted">{endReason}</span> : null}
          </div>
        </div>
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-[22px] font-medium tabular-nums">{elapsed === null ? "—" : clock(elapsed)}</span>
          {maxS ? <span className="text-xs text-dim">{t("live.max", { duration: clock(maxS * 1000) })}</span> : null}
        </div>
      </div>
      <ConnectionNotice state={connection} />
      {cancel.isError ? (
        <Alert>
          {t(text ? "live.endConversationFailed" : "live.endCallFailed", { error: errorMessage(cancel.error) })}
        </Alert>
      ) : null}
      {audioError ? <Alert title={t("live.audioFailed")}>{audioError}</Alert> : null}
      {!text && autoListen && needsClick && !listening && active ? (
        <p role="status" className="text-sm text-muted">
          {t("live.needsClick")}
        </p>
      ) : null}
      {text ? null : (
        <>
          <ListenControls
            listening={listening}
            disabled={!active}
            onListen={() => void listen()}
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
            <h3 className="text-sm font-semibold">{text ? t("live.liveConversation") : t("live.liveTranscript")}</h3>
          </div>
          {text ? (
            <ChatTranscript live entries={state.entries} emptyText={t("live.noMessages")} pending={state.pending} />
          ) : (
            <LiveTranscript entries={state.entries} pending={state.pending} />
          )}
          {state.interruptions.length > 0 ? (
            <ul aria-label={t("live.callerInterruptions")} className="flex flex-col gap-0.5 text-xs text-dim">
              {state.interruptions.map((interruption, index) => (
                <li key={index}>
                  {t("live.interruptionLine", {
                    turn: interruption.agentTurn ?? "?",
                    at: interruptedAt(t, interruption.audioEndMs),
                    text: interruption.heardText,
                    confirmation: confirmationLabel(t, interruption, state.finished),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          {state.bargeIns.length > 0 ? (
            <ul aria-label={t("live.bargeIns")} className="flex flex-col gap-0.5 text-xs text-dim">
              {state.bargeIns.map((bargeIn, index) => (
                <li key={index}>{t("live.bargeIn", { at: bargeIn.tMs === null ? "—" : clock(bargeIn.tMs) })}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3.5">
            {active ? (
              <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(runId)}>
                {text ? t("live.endConversation") : t("live.endCall")}
              </Button>
            ) : (
              <Link href={`/runs/${encodeURIComponent(runId)}`} className={buttonClasses("secondary")}>
                {t("live.openReport")}
              </Link>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-4">
          <RailBox
            id={`${headingId}-goals`}
            title={t("live.goals")}
            note={text ? t("live.goalsNoteText") : t("live.goalsNoteVoice")}
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
              <p className="text-[13px] text-muted">{t("live.noGoals")}</p>
            )}
          </RailBox>
          <section aria-labelledby={`${headingId}-metrics`} className="flex flex-col gap-2.5">
            <h3 id={`${headingId}-metrics`} className="sr-only">
              {text ? t("live.conversationMetrics") : t("live.callMetrics")}
            </h3>
            {text ? (
              <div className="grid grid-cols-2 gap-2.5">
                <Metric label={t("live.avgFirstText")} ms={metrics.avgLatencyMs} />
                <Metric label={t("report.metric.slowestFirstText")} ms={metrics.slowestMs} flagSlow />
                <KpiTile className={TILE} label={t("live.messages")} value={metrics.turns} />
                <KpiTile className={TILE} label={t("report.metric.toolsUsed")} value={toolsUsed} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <Metric label={t("live.avgLatency")} ms={metrics.avgLatencyMs} />
                <Metric label={t("live.slowestTurn")} ms={metrics.slowestMs} flagSlow />
                <KpiTile className={TILE} label={t("runs.metric.turns")} value={metrics.turns} />
                <KpiTile
                  className={TILE}
                  label={t("live.interruptions")}
                  value={metrics.interruptions}
                  sub={metrics.interruptions > 0 ? t("live.confirmedCount", { count: metrics.confirmed }) : undefined}
                />
              </div>
            )}
          </section>
          <RailBox id={`${headingId}-intent`} title={t("live.intent")}>
            {state.decision ? (
              <div className="flex flex-col gap-1.5 text-sm">
                <p className="text-evaluator-fg">
                  {state.decision.discarded ? `${t("live.discarded")} ` : ""}
                  {state.decision.say
                    ? t(text ? "live.sends" : "live.says", { text: state.decision.say })
                    : state.decision.hangUp
                      ? text
                        ? t("live.endsConversation")
                        : t("live.hangsUp")
                      : t("live.staysSilent")}
                </p>
                {callerIntent(state.decision.reason) ? <p className="text-muted">{state.decision.reason}</p> : null}
              </div>
            ) : (
              <p className="text-sm text-muted">{t("live.noDecision")}</p>
            )}
          </RailBox>
          {state.warnings.length > 0 ? (
            <RailBox id={`${headingId}-warnings`} title={t("report.warnings")}>
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

/** Whether the page got a click (or key press) yet; unknown counts as yes. */
function hasUserGesture(): boolean {
  const activation = typeof navigator === "undefined" ? undefined : navigator.userActivation;
  return activation === undefined || activation.hasBeenActive;
}

const TILE = "gap-1.5 rounded-[10px] bg-raised px-3.5 py-3";

/** A latency tile: number and unit apart ("1.4" "s"), red past the slow threshold when asked. */
function Metric({ label, ms, flagSlow = false }: { label: string; ms: number | null; flagSlow?: boolean }) {
  const t = useT();
  if (ms === null) return <KpiTile className={TILE} label={label} value="—" />;
  const [value, unit] = latency(ms).split(" ");
  const slow = flagSlow && ms > SLOW_TURN_MS;
  return (
    <KpiTile
      className={TILE}
      label={label}
      value={<span className={cn(slow && "text-danger-fg")}>{value}</span>}
      unit={unit}
      sub={slow ? t("live.slowTag") : undefined}
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
  const t = useT();
  if (state.kind === "error") return <Alert>{liveConnectionError(t, state.code, "run")}</Alert>;
  if (state.kind === "reconnecting") {
    return (
      <p role="status" className="text-sm text-muted">
        {t("live.reconnecting", { seconds: Math.round(state.delayMs / 1000), attempt: state.attempt })}
      </p>
    );
  }
  return null;
}
