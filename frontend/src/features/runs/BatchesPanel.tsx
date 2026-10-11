import Link from "next/link";
import { relativeTime } from "@/features/connections/format";
import { Badge, Card, CardHeader, buttonClasses, cn, focusRing } from "@/ui";
import { shortId } from "./format";
import type { Batch, RunStatus } from "./types";

const FINISHED: RunStatus[] = ["completed", "failed", "cancelled", "interrupted"];

export function batchName(batch: Pick<Batch, "id" | "label">): string {
  return batch.label ?? `Batch ${shortId(batch.id)}`;
}

export function finishedCount(batch: Pick<Batch, "counts">): number {
  return FINISHED.reduce((sum, status) => sum + (batch.counts[status] ?? 0), 0);
}

const isLive = (batch: Batch) => batch.status === "queued" || batch.status === "running";

/** Recent batches with their progress; picking one filters the runs list. */
export function BatchesPanel({ batches, now, onPick }: { batches: Batch[]; now: number; onPick: (batch: Batch) => void }) {
  const headingId = "recent-batches";
  return (
    <Card aria-labelledby={headingId}>
      <CardHeader id={headingId} title="Recent batches" />
      <ul className="flex flex-col gap-2">
        {batches.map((batch) => {
          const name = batchName(batch);
          const finished = finishedCount(batch);
          const percent = batch.total ? Math.round((finished / batch.total) * 100) : 0;
          return (
            <li
              key={batch.id}
              aria-label={name}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-soft px-3 py-2.5"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => onPick(batch)}
                  className={cn("truncate rounded text-left text-sm font-medium hover:underline", focusRing)}
                >
                  {name}
                </button>
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span>{`${finished} of ${batch.total} finished`}</span>
                  <span aria-hidden="true">·</span>
                  <span>{relativeTime(batch.createdAt, now)}</span>
                  {isLive(batch) ? <Badge tone="evaluator">In progress</Badge> : null}
                </div>
                <div
                  role="progressbar"
                  aria-label={`${name} progress`}
                  aria-valuemin={0}
                  aria-valuemax={batch.total}
                  aria-valuenow={finished}
                  className="h-1 w-48 max-w-full overflow-hidden rounded-full bg-chip"
                >
                  <div className="h-full bg-evaluator" style={{ width: `${percent}%` }} />
                </div>
              </div>
              {isLive(batch) ? (
                <Link
                  href={`/live?batchId=${encodeURIComponent(batch.id)}`}
                  aria-label={`Watch ${name} live`}
                  className={buttonClasses("secondary", "min-h-9 px-3")}
                >
                  Live
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
