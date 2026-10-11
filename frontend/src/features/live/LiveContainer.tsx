"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { batchName, finishedCount } from "@/features/runs/BatchesPanel";
import { isActive } from "@/features/runs/format";
import { useBatch, useCancelBatch, useRuns } from "@/features/runs/queries";
import type { Run, RunStatus } from "@/features/runs/types";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useNow } from "@/lib/time/use-now";
import { Alert, Badge, Button, EmptyState, LiveIcon, Spinner, buttonClasses } from "@/ui";
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

  let body;
  if (queries.some((query) => query.isPending)) body = <Spinner label="Loading live sessions" />;
  else if (failed) body = <Alert title="Could not load live sessions">{errorMessage(failed.error)}</Alert>;
  else body = <Sessions sessions={sessions} />;

  return (
    <>
      <PageHeader title="Live sessions" description="Calls in progress between the evaluator and your agents." />
      {body}
    </>
  );
}

function BatchLive({ batchId }: { batchId: string }) {
  const batch = useBatch(batchId, { refetchInterval: POLL_MS * 2 });
  const live = useBatchLive(batchId);
  const stop = useCancelBatch();
  const sessions = [...(live.state.batch ? live.state.runs : (batch.data?.runs ?? []))].sort(byProgress);
  const finished = live.state.finished || (batch.data !== undefined && !["queued", "running"].includes(batch.data.status));
  const done = finishedCount({ counts: countByStatus(sessions) });
  const total = live.state.batch?.total ?? batch.data?.total ?? sessions.length;
  const title = batch.data ? batchName(batch.data) : "Batch";

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/live">Live sessions</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{title}</span>
      </nav>
      <PageHeader
        title={title}
        description={batch.data ? `Concurrency ${batch.data.concurrency} · ${total} runs` : undefined}
        actions={
          <>
            <Link href={`/runs?batchId=${encodeURIComponent(batchId)}`} className={buttonClasses("secondary")}>
              Runs of this batch
            </Link>
            {!finished ? (
              <Button variant="danger" loading={stop.isPending} onClick={() => stop.mutate(batchId)}>
                Stop all
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>{`${done} finished`}</span>
        {finished ? <Badge tone="success">Batch finished</Badge> : null}
      </div>
      {live.connection.kind === "error" ? <Alert>{live.connection.message}</Alert> : null}
      {stop.isError ? <Alert>{`Could not stop the batch: ${errorMessage(stop.error)}`}</Alert> : null}
      {batch.isPending && !live.state.batch ? <Spinner label="Loading batch" /> : <Sessions sessions={sessions} />}
    </>
  );
}

function countByStatus(runs: Run[]): Partial<Record<RunStatus, number>> {
  const counts: Partial<Record<RunStatus, number>> = {};
  for (const run of runs) counts[run.status] = (counts[run.status] ?? 0) + 1;
  return counts;
}

function Sessions({ sessions }: { sessions: Run[] }) {
  const now = useNow(1000);
  const [picked, setPicked] = useState<string | undefined>(undefined);

  if (sessions.length === 0) {
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

  const fallback = sessions.find((run) => isActive(run.status) && run.status !== "queued") ?? sessions[0];
  const focusId = picked && sessions.some((run) => run.id === picked) ? picked : fallback.id;

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ul aria-label="Sessions" className="flex flex-col gap-2.5">
        {sessions.map((run) => (
          <li key={run.id}>
            <SessionCard run={run} now={now} selected={run.id === focusId} onSelect={() => setPicked(run.id)} />
          </li>
        ))}
      </ul>
      <LiveRunPanel key={focusId} runId={focusId} />
    </div>
  );
}
