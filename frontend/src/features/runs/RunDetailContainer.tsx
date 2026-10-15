"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useJudgementController } from "@/features/judgements/use-judgement-controller";
import { ApiError, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
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
import { runKind } from "./kind";
import { notRunnableReasons } from "./launch";
import { useCancelRun, useRerun, useRun, useRunTrace } from "./queries";
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
  const t = useT();
  const run = useRun(runId, { pollWhileActiveMs: POLL_MS });

  if (run.isError && run.error instanceof ApiError && run.error.status === 404) {
    return (
      <EmptyState
        icon={<RunsIcon size={22} />}
        title={t("runs.notFound")}
        description={t("runs.notFoundHint")}
        action={
          <Link href="/runs" className={buttonClasses("secondary")}>
            {t("runs.backToRuns")}
          </Link>
        }
      />
    );
  }
  if (run.isError) {
    return (
      <Alert title={t("runs.loadOneFailed")}>
        <span className="block">{errorMessage(run.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => run.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  }
  if (run.isPending) return <Spinner label={t("runs.loadingOne")} />;
  return <RunReport run={run.data} judgementPollMs={judgementPollMs} />;
}

function RunReport({ run, judgementPollMs }: { run: RunDetail; judgementPollMs?: number }) {
  const t = useT();
  const router = useRouter();
  const cancel = useCancelRun();
  const rerun = useRerun();
  const [confirming, setConfirming] = useState(false);
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const launching = useRef(false);
  const active = isActive(run.status);
  const controller = useJudgementController(run.id, { enabled: !active, endedAt: run.endedAt, pollMs: judgementPollMs });
  const trace = useRunTrace(run.id, { enabled: !active });
  // The session shows every turn of the run; a single trace only when the session is unknown.
  const threadTracesUrl = trace.data?.langfuse?.threadTracesUrl ?? null;
  const langfuseUrl = threadTracesUrl ?? trace.data?.langfuse?.traceUrl ?? null;

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
        reasons: notRunnableReasons(t, rerun.error, [{ id: run.scenarioId ?? "", name: run.scenarioName }]),
      }
    : null;

  const actions = (
    <>
      {active ? (
        <>
          <Link href={`/runs/${encodeURIComponent(run.id)}/live`} className={buttonClasses("primary")}>
            {t("runs.watchLiveButton")}
          </Link>
          <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(run.id)}>
            {t("runs.cancelRunButton")}
          </Button>
        </>
      ) : null}
      {langfuseUrl ? (
        <a href={langfuseUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary")}>
          {threadTracesUrl ? t("runs.openThreadTraces") : t("runs.openTrace")}
          <ExternalLinkIcon size={14} />
          <span className="sr-only">{` ${t("common.newTab")}`}</span>
        </a>
      ) : null}
      {run.scenarioId ? (
        <Button
          variant="secondary"
          onClick={() => {
            rerun.reset();
            setConfirming(true);
          }}
          title={t("runs.rerunHint")}
        >
          {t("runs.rerun")}
        </Button>
      ) : null}
      {controller.brief ? (
        <Button icon={controller.briefCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />} onClick={controller.copyBrief}>
          {t("report.copyBrief")}
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <RunHeader run={run} actions={actions} />
      {run.error ? <Alert title={t("runs.runFailed")}>{run.error}</Alert> : null}
      {cancel.isError ? <Alert>{t("runs.cancelFailed", { error: errorMessage(cancel.error) })}</Alert> : null}
      {active ? (
        <>
          <Alert tone="info">
            {runKind(run) === "text" ? t("runs.activeTextHint") : t("runs.activeVoiceHint")}
          </Alert>
          <Card aria-labelledby="judgement-status">
            <CardHeader id="judgement-status" title={t("judgement.title")} />
            <p className="text-sm text-muted">{t("judgement.afterRun")}</p>
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
