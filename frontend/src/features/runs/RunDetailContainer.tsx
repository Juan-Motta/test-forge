"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useJudgementController } from "@/features/judgements/use-judgement-controller";
import { ApiError, errorMessage } from "@/lib/api";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CheckIcon,
  CopyIcon,
  EmptyState,
  ExternalLinkIcon,
  RunsIcon,
  Spinner,
  buttonClasses,
} from "@/ui";
import { isActive } from "./format";
import { notRunnableReasons } from "./launch";
import { useCancelRun, useLangfuseHost, useRerun, useRun, useRunTrace } from "./queries";
import { FinishedReport } from "./report/FinishedReport";
import { RerunDialog } from "./report/RerunDialog";
import { RunHeader } from "./RunHeader";
import type { RunDetail } from "./types";

const POLL_MS = 3000;

type RunDetailContainerProps = {
  runId: string;
  /** Polling interval while the judgement is in progress (tests shorten it). */
  judgementPollMs?: number;
};

/** Container for `/runs/[id]`: the run report and, once it finished, the judge's verdict. */
export function RunDetailContainer({ runId, judgementPollMs }: RunDetailContainerProps) {
  const run = useRun(runId, { pollWhileActiveMs: POLL_MS });

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
  return <RunReport run={run.data} judgementPollMs={judgementPollMs} />;
}

function RunReport({ run, judgementPollMs }: { run: RunDetail; judgementPollMs?: number }) {
  const router = useRouter();
  const cancel = useCancelRun();
  const rerun = useRerun();
  const [confirming, setConfirming] = useState(false);
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const launching = useRef(false);
  const active = isActive(run.status);
  const controller = useJudgementController(run.id, { enabled: !active, endedAt: run.endedAt, pollMs: judgementPollMs });
  const trace = useRunTrace(run.id, { enabled: !active });
  const traceId = trace.data?.available ? trace.data.observations.find((item) => item.traceId)?.traceId : undefined;
  const langfuseHost = useLangfuseHost(run.agentId, { enabled: Boolean(traceId) });

  function onConfirmRerun() {
    if (launching.current) return;
    launching.current = true;
    rerun.mutate(run.id, {
      onSuccess: (batch) => router.push(`/live?batchId=${encodeURIComponent(batch.id)}`),
      onSettled: () => (launching.current = false),
    });
  }

  const rerunError = rerun.isError
    ? {
        message: errorMessage(rerun.error),
        reasons: notRunnableReasons(rerun.error, [{ id: run.scenarioId ?? "", name: run.scenarioName }]),
      }
    : null;

  const actions = (
    <>
      {active ? (
        <>
          <Link href={`/runs/${encodeURIComponent(run.id)}/live`} className={buttonClasses("primary")}>
            Watch live
          </Link>
          <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(run.id)}>
            Cancel run
          </Button>
        </>
      ) : null}
      {langfuseHost && traceId ? (
        <a
          href={`${langfuseHost}/trace/${encodeURIComponent(traceId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses("secondary")}
        >
          Open trace in Langfuse
          <ExternalLinkIcon size={14} />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : null}
      {run.scenarioId ? (
        <Button
          variant="secondary"
          onClick={() => {
            rerun.reset();
            setConfirming(true);
          }}
          title="Launch this scenario once more (its current version)"
        >
          Re-run
        </Button>
      ) : null}
      {controller.brief ? (
        <Button icon={controller.briefCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />} onClick={controller.copyBrief}>
          Copy brief
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <RunHeader run={run} actions={actions} />
      {run.error ? <Alert title="The run failed">{run.error}</Alert> : null}
      {cancel.isError ? <Alert>{`Could not cancel: ${errorMessage(cancel.error)}`}</Alert> : null}
      {active ? (
        <>
          <Alert tone="info">The recording and transcript appear once the run finishes. Watch it live meanwhile.</Alert>
          <Card aria-labelledby="judgement-status">
            <CardHeader id="judgement-status" title="Judgement" />
            <p className="text-sm text-muted">The judge scores the run once it finishes.</p>
          </Card>
        </>
      ) : (
        <FinishedReport run={run} controller={controller} />
      )}
      <RerunDialog
        open={confirming}
        scenarioName={run.scenarioName}
        agentName={run.agentName}
        onConfirm={onConfirmRerun}
        onClose={() => setConfirming(false)}
        pending={rerun.isPending}
        error={rerunError}
      />
    </>
  );
}
