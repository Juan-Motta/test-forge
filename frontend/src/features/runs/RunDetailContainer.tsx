"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { ApiError, errorMessage } from "@/lib/api";
import { Alert, Button, Card, CardHeader, EmptyState, RunsIcon, Spinner, buttonClasses } from "@/ui";
import { audioUrl } from "./api";
import { clock, isActive, latency, median } from "./format";
import { useCancelRun, useLaunchRuns, useRun } from "./queries";
import { RunMeta } from "./RunHeader";
import { RunTranscript } from "./RunTranscript";
import { entriesFromRows } from "./transcript";
import type { RunDetail } from "./types";

const POLL_MS = 3000;

/** Container for `/runs/[id]`: the run report (no judge scores yet). */
export function RunDetailContainer({ runId }: { runId: string }) {
  const router = useRouter();
  const run = useRun(runId, { pollWhileActiveMs: POLL_MS });
  const cancel = useCancelRun();
  const rerun = useLaunchRuns();
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const launching = useRef(false);

  if (run.isError && run.error instanceof ApiError && run.error.status === 404) {
    return (
      <EmptyState
        icon={<RunsIcon size={22} />}
        title="Run not found"
        description="It may have been removed, or the link is wrong."
        action={
          <Link href="/runs" className={buttonClasses("secondary")}>
            Back to runs
          </Link>
        }
      />
    );
  }
  if (run.isError) {
    return (
      <Alert title="Could not load the run">
        <span className="block">{errorMessage(run.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => run.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  }
  if (run.isPending) return <Spinner label="Loading run" />;

  const data = run.data;
  const active = isActive(data.status);

  function onRerun(scenarioId: string) {
    if (launching.current) return;
    launching.current = true;
    rerun.mutate(
      { scenarioIds: [scenarioId], repetitions: 1, concurrency: 1 },
      {
        onSuccess: (batch) => router.push(`/live?batchId=${encodeURIComponent(batch.id)}`),
        onSettled: () => (launching.current = false),
      },
    );
  }

  const actions = (
    <>
      {active ? (
        <>
          <Link href={`/runs/${encodeURIComponent(data.id)}/live`} className={buttonClasses("primary")}>
            Watch live
          </Link>
          <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(data.id)}>
            Cancel run
          </Button>
        </>
      ) : null}
      {data.scenarioId ? (
        <Button
          variant={active ? "secondary" : "primary"}
          loading={rerun.isPending}
          onClick={() => onRerun(data.scenarioId as string)}
          title="Launch this scenario once more (its current version)"
        >
          Re-run
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/runs">Runs</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/runs?batchId=${encodeURIComponent(data.batchId)}`}>Batch</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Run</span>
      </nav>
      <PageHeader title={data.scenarioName} actions={actions} />
      <RunMeta run={data} />
      {data.error ? <Alert title="The run failed">{data.error}</Alert> : null}
      {cancel.isError ? <Alert>{`Could not cancel: ${errorMessage(cancel.error)}`}</Alert> : null}
      {rerun.isError ? <Alert>{`Could not re-run: ${errorMessage(rerun.error)}`}</Alert> : null}
      {active ? (
        <Alert tone="info">The recording and transcript appear once the run finishes. Watch it live meanwhile.</Alert>
      ) : (
        <FinishedReport run={data} />
      )}
      <Card aria-labelledby="score-suggestions">
        <CardHeader id="score-suggestions" title="Score & suggestions" />
        <p className="text-sm text-muted">
          Coming with the judge: scores per criterion, findings and suggested fixes will appear here. Nothing is
          scored yet.
        </p>
      </Card>
    </>
  );
}

function FinishedReport({ run }: { run: RunDetail }) {
  const summary = run.summary ?? {};
  const latencies = summary.latenciesMs ?? [];
  const metrics = [
    { label: "Duration", value: summary.durationMs === undefined ? "—" : clock(summary.durationMs) },
    { label: "Latency p50", value: latency(median(latencies)) },
    { label: "Slowest reply", value: latencies.length ? latency(Math.max(...latencies)) : "—" },
    { label: "Agent turns", value: summary.agentTurns === undefined ? "—" : String(summary.agentTurns) },
    { label: "Evaluator turns", value: summary.callerTurns === undefined ? "—" : String(summary.callerTurns) },
  ];
  const warnings = summary.warnings ?? [];

  return (
    <>
      <ul aria-label="Run metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {metrics.map((metric) => (
          <li key={metric.label} aria-label={metric.label} className="flex flex-col gap-1 rounded-xl border border-line bg-panel p-4">
            <span className="text-xs text-muted">{metric.label}</span>
            <span className="font-mono text-xl font-semibold">{metric.value}</span>
          </li>
        ))}
      </ul>
      {warnings.length > 0 ? (
        <Alert tone="info" title="Warnings">
          <ul className="flex flex-col gap-1">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <Card aria-labelledby="call-recording">
        <CardHeader id="call-recording" title="Call recording" />
        <p className="text-xs text-muted">
          One track per side. The agent track holds only the audio the agent sent, without the pauses between its
          turns, so the two tracks are not aligned in time.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Track label="Agent track" src={audioUrl(run.id, "agent")} tone="text-agent" />
          <Track label="Evaluator track" src={audioUrl(run.id, "caller")} tone="text-evaluator-fg" />
        </div>
      </Card>
      <Card aria-labelledby="run-transcript">
        <CardHeader id="run-transcript" title="Transcript" />
        <RunTranscript entries={entriesFromRows(run.transcript ?? [])} emptyText="Nothing was said in this run." />
      </Card>
    </>
  );
}

function Track({ label, src, tone }: { label: string; src: string; tone: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className={`font-semibold ${tone}`}>{label}</span>
        <a href={src} download className="text-muted hover:text-fg">
          Download .wav
        </a>
      </div>
      <audio controls preload="none" src={src} aria-label={label} className="w-full" />
    </div>
  );
}
