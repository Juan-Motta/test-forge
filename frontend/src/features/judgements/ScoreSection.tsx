import { Alert, Button, Card, CardHeader, Spinner } from "@/ui";
import { elapsed, isJudging } from "./format";
import { JudgementReport } from "./JudgementReport";
import type { Judgement } from "./types";

type ScoreSectionProps = {
  judgement: Judgement | undefined;
  loadError: string | null;
  onReload: () => void;
  /** Starts a (re-)judgement. */
  onJudge: () => void;
  judgeStarting: boolean;
  judgeError: string | null;
  onCopyBrief: () => void;
  briefCopied: boolean;
  onDownloadBrief: () => void;
  now: number;
};

const PROGRESS: Record<"pending" | "judging", string> = {
  pending: "Queued for the judge…",
  judging: "The judge is scoring this run…",
};

/** "Score & suggestions" of a finished run, in whichever state its judgement is. */
export function ScoreSection(props: ScoreSectionProps) {
  const { judgement, onJudge, judgeStarting, judgeError } = props;
  const status = judgement?.status;
  const action =
    status === undefined ? null : (
      <Button
        variant="secondary"
        className="min-h-9 px-3"
        loading={judgeStarting}
        disabled={isJudging(status)}
        onClick={onJudge}
      >
        {status === "none" ? "Judge run" : "Re-judge"}
      </Button>
    );

  return (
    <Card aria-labelledby="score-suggestions">
      <CardHeader id="score-suggestions" title="Score & suggestions" actions={action} />
      {judgeError ? <Alert>{`Could not judge: ${judgeError}`}</Alert> : null}
      <Body {...props} />
    </Card>
  );
}

function Body({
  judgement,
  loadError,
  onReload,
  onJudge,
  judgeStarting,
  onCopyBrief,
  briefCopied,
  onDownloadBrief,
  now,
}: ScoreSectionProps) {
  if (loadError) {
    return (
      <Alert title="Could not load the judgement">
        <span className="block">{loadError}</span>
        <Button variant="secondary" className="mt-3" onClick={onReload}>
          Try again
        </Button>
      </Alert>
    );
  }
  if (!judgement) return <Spinner label="Loading judgement" />;

  switch (judgement.status) {
    case "none":
      return <p className="text-sm text-muted">Not judged yet.</p>;
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
          <Button variant="secondary" className="mt-3" loading={judgeStarting} onClick={onJudge}>
            Retry
          </Button>
        </Alert>
      );
    case "completed":
      return judgement.result ? (
        <JudgementReport
          result={judgement.result}
          onCopyBrief={onCopyBrief}
          copied={briefCopied}
          onDownloadBrief={onDownloadBrief}
        />
      ) : (
        <p className="text-sm text-muted">The judgement finished without a result.</p>
      );
  }
}
