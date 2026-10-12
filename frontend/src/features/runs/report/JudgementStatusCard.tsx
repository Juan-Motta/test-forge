import { elapsed, isJudging } from "@/features/judgements/format";
import type { JudgementController } from "@/features/judgements/use-judgement-controller";
import { Alert, Button, Card, CardHeader, Spinner } from "@/ui";

const PROGRESS: Record<"pending" | "judging", string> = {
  pending: "Queued for the judge…",
  judging: "The judge is scoring this run…",
};

/** The Judge run / Re-judge button; disabled while a judgement is in progress. */
export function JudgeButton({ controller }: { controller: JudgementController }) {
  const status = controller.judgement?.status;
  if (status === undefined) return null;
  return (
    <Button
      variant="secondary"
      className="min-h-9 px-3"
      loading={controller.judgeStarting}
      disabled={isJudging(status)}
      onClick={controller.judge}
    >
      {status === "none" ? "Judge run" : "Re-judge"}
    </Button>
  );
}

/** The judgement while it is not completed: not judged, queued, waiting for traces, judging or failed. */
export function JudgementStatusCard({ controller }: { controller: JudgementController }) {
  return (
    <Card aria-labelledby="judgement-status">
      <CardHeader id="judgement-status" title="Judgement" actions={<JudgeButton controller={controller} />} />
      {controller.judgeError ? <Alert>{`Could not judge: ${controller.judgeError}`}</Alert> : null}
      <Body controller={controller} />
    </Card>
  );
}

function Body({ controller }: { controller: JudgementController }) {
  const { judgement, loadError, reload, judge, judgeStarting, now } = controller;
  if (loadError) {
    return (
      <Alert title="Could not load the judgement">
        <span className="block">{loadError}</span>
        <Button variant="secondary" className="mt-3" onClick={reload}>
          Try again
        </Button>
      </Alert>
    );
  }
  if (!judgement) return <Spinner label="Loading judgement" />;

  switch (judgement.status) {
    case "none":
      return <p className="text-sm text-muted">Not judged yet. Judge the run to get its score, scorecard and suggestions.</p>;
    case "pending":
    case "judging":
      return (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> {PROGRESS[judgement.status]}
        </p>
      );
    case "collecting_traces": {
      const since = Date.parse(judgement.updatedAt);
      return (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Spinner /> Waiting for Langfuse traces — they can take up to ~15 min to appear.
          {now > 0 && !Number.isNaN(since) ? <span className="font-mono">{`Waiting ${elapsed(now - since)}`}</span> : null}
        </p>
      );
    }
    case "failed":
      return (
        <Alert title="The judgement failed">
          <span className="block">{judgement.error ?? "Unknown error."}</span>
          <Button variant="secondary" className="mt-3" loading={judgeStarting} onClick={judge}>
            Retry
          </Button>
        </Alert>
      );
    case "completed":
      return <p className="text-sm text-muted">The judgement finished without a result.</p>;
  }
}
