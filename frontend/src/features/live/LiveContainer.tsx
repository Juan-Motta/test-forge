"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { isActive } from "@/features/runs/format";
import { useBatch, useCancelBatch, useRun, useRuns } from "@/features/runs/queries";
import type { Run, RunStatus } from "@/features/runs/types";
import { createLevelMeter, type ChannelLevels, type LevelMeter } from "@/lib/live/levels";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useNow } from "@/lib/time/use-now";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  LiveIcon,
  Spinner,
  StackedProgress,
  buttonClasses,
  cn,
  focusRing,
} from "@/ui";
import { batchEyebrow, batchSegments, type SessionStats } from "./live-view";
import { LiveRunPanel } from "./LiveRunPanel";
import { SessionCard } from "./SessionCard";
import { useBatchLive } from "./use-batch-live";

const POLL_MS = 3000;
const ACTIVE_PAGE = { limit: 50 } as const;
const ORDER: Record<RunStatus, number> = {
  running: 0,
  connecting: 1,
  queued: 2,
  completed: 3,
  failed: 3,
  cancelled: 3,
  interrupted: 3,
};

function byProgress(a: Run, b: Run): number {
  return ORDER[a.status] - ORDER[b.status] || a.createdAt.localeCompare(b.createdAt) || a.position - b.position;
}

/**
 * Container for `/live`: every active run (polled), or one batch followed over its overview
 * stream (`?batchId=`). The focused run streams its transcript and audio.
 */
export function LiveContainer() {
  const batchId = useSearchParams().get("batchId") || undefined;
  return batchId ? <BatchLive batchId={batchId} /> : <AllActive />;
}

function AllActive() {
  const running = useRuns({ ...ACTIVE_PAGE, status: "running" }, { refetchInterval: POLL_MS });
  const connecting = useRuns({ ...ACTIVE_PAGE, status: "connecting" }, { refetchInterval: POLL_MS });
  const queued = useRuns({ ...ACTIVE_PAGE, status: "queued" }, { refetchInterval: POLL_MS });
  const queries = [running, connecting, queued];
  const sessions = queries.flatMap((query) => query.data?.items ?? []).sort(byProgress);
  const failed = queries.find((query) => query.isError);
  const loaded = queries.some((query) => query.data !== undefined);

  let body;
  if (queries.some((query) => query.isPending)) body = <Spinner label="Loading live sessions" />;
  else if (failed && !loaded) body = <Alert title="Could not load live sessions">{errorMessage(failed.error)}</Alert>;
  else body = <Sessions sessions={sessions} />;

  return (
    <>
      <PageHeader eyebrow="All active runs" title="Live sessions" />
      {/* One failing poll must not hide what the others (or earlier polls) loaded. */}
      {failed && loaded ? (
        <Alert title="Some live sessions could not be loaded">{errorMessage(failed.error)}</Alert>
      ) : null}
      {body}
    </>
  );
}

function BatchLive({ batchId }: { batchId: string }) {
  const batch = useBatch(batchId, { refetchInterval: POLL_MS * 2 });
  const live = useBatchLive(batchId);
  const stop = useCancelBatch();
  const [confirming, setConfirming] = useState(false);
  const sessions = [...(live.state.batch ? live.state.runs : (batch.data?.runs ?? []))].sort(byProgress);
  const finished = live.state.finished || (batch.data !== undefined && !["queued", "running"].includes(batch.data.status));
  const total = live.state.batch?.total ?? batch.data?.total ?? sessions.length;
  const runsTotal = `${total} runs total`;

  return (
    <>
      <PageHeader
        eyebrow={batch.data ? batchEyebrow(batch.data) : `Batch ${batchId.slice(0, 8)}`}
        title="Live sessions"
        actions={
          <>
            {finished ? <Badge tone="success">Batch finished</Badge> : null}
            <Link href={`/runs?batchId=${encodeURIComponent(batchId)}`} className={buttonClasses("secondary")}>
              Runs of this batch
            </Link>
            {!finished ? (
              <button type="button" onClick={() => setConfirming(true)} className={STOP_ALL}>
                <StopIcon />
                Stop all
              </button>
            ) : null}
          </>
        }
      />
      <section aria-label="Batch progress">
        <StackedProgress
          label="Batch progress"
          segments={batchSegments(sessions)}
          extra={batch.data ? `Concurrency ${batch.data.concurrency} · ${runsTotal}` : runsTotal}
        />
      </section>
      {live.connection.kind === "error" ? <Alert>{live.connection.message}</Alert> : null}
      {stop.isError ? <Alert>{`Could not stop the batch: ${errorMessage(stop.error)}`}</Alert> : null}
      {batch.isPending && !live.state.batch ? <Spinner label="Loading batch" /> : <Sessions sessions={sessions} />}
      <Dialog
        open={confirming}
        title="Stop the whole batch?"
        description="This ends every call in progress and cancels the runs still queued. Finished runs keep their results."
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep running
            </Button>
            <Button
              variant="danger"
              loading={stop.isPending}
              onClick={() => stop.mutate(batchId, { onSettled: () => setConfirming(false) })}
            >
              Stop all
            </Button>
          </>
        }
      />
    </>
  );
}

const STOP_ALL = cn(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-danger/35 bg-danger/12 px-4",
  "text-sm font-medium text-danger-fg transition-colors hover:bg-danger/20",
  focusRing,
);

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

/** Lane audio and stream stats of the focused run, shared by its panel and its session card. */
type FocusFeed = { id: string; meter: LevelMeter; stats?: SessionStats };

/** Bars on a session card: the last 10 s. */
const CARD_BINS = 40;

function Sessions({ sessions }: { sessions: Run[] }) {
  const now = useNow(1000);
  // The focused run, as last listed. It stays focused (and listed) after it ends and drops out of
  // the active list, until the user picks another: the focus never jumps on its own.
  const [focused, setFocused] = useState<Run | undefined>(undefined);
  const [feed, setFeed] = useState<FocusFeed | null>(null);
  const fallback = sessions.find((run) => isActive(run.status) && run.status !== "queued") ?? sessions[0];
  if (focused === undefined && fallback !== undefined) setFocused(fallback);
  const focus = focused ?? fallback;
  if (focus !== undefined && feed?.id !== focus.id) setFeed({ id: focus.id, meter: createLevelMeter() });

  if (focus === undefined) {
    return (
      <EmptyState
        icon={<LiveIcon size={22} />}
        title="No calls in progress"
        description="Launch a scenario to watch and listen to its call here."
        action={
          <Link href="/scenarios" className={buttonClasses("secondary")}>
            Go to scenarios
          </Link>
        }
      />
    );
  }

  const current = feed?.id === focus.id ? feed : null;
  const focusId = focus.id;
  const retained = sessions.some((run) => run.id === focus.id) ? undefined : focus;
  const levels = current ? current.meter.levels(now, CARD_BINS) : undefined;
  const card = (run: Run) => {
    const selected = run.id === focus.id;
    return (
      <SessionCard
        run={run}
        now={now}
        selected={selected}
        onSelect={() => setFocused(run)}
        levels={selected ? levels : undefined}
        stats={selected ? current?.stats : undefined}
      />
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ul aria-label="Sessions" className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1">
        {sessions.map((run) => (
          <li key={run.id} className="w-[min(340px,85vw)] shrink-0 snap-start">
            {card(run)}
          </li>
        ))}
        {retained ? (
          <li key={retained.id} className="w-[min(340px,85vw)] shrink-0 snap-start">
            <RetainedCard run={retained} now={now} levels={levels} stats={current?.stats} />
          </li>
        ) : null}
      </ul>
      {current ? (
        <LiveRunPanel
          key={focus.id}
          runId={focus.id}
          meter={current.meter}
          onStats={(stats) => setFeed((previous) => (previous?.id === focusId ? { ...previous, stats } : previous))}
        />
      ) : null}
    </div>
  );
}

/** The focused run after it left the active list: its latest state comes from the run itself. */
function RetainedCard({ run, now, levels, stats }: { run: Run; now: number; levels?: ChannelLevels; stats?: SessionStats }) {
  const latest = useRun(run.id).data;
  return <SessionCard run={latest ?? run} now={now} selected onSelect={() => undefined} levels={levels} stats={stats} />;
}
