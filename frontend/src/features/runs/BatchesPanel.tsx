import Link from "next/link";
import { useFormat, useT, type Translator } from "@/lib/i18n";
import { Badge, Card, CardHeader, LiveDot, buttonClasses, cn, focusRing } from "@/ui";
import { shortId } from "./format";
import type { Batch, RunStatus } from "./types";

const FINISHED: RunStatus[] = ["completed", "failed", "cancelled", "interrupted"];

export function batchName(t: Translator, batch: Pick<Batch, "id" | "label">): string {
  return batch.label ?? t("runs.batch", { id: shortId(batch.id) });
}

export function finishedCount(batch: Pick<Batch, "counts">): number {
  return FINISHED.reduce((sum, status) => sum + (batch.counts[status] ?? 0), 0);
}

/** Finished runs drawn by outcome; the rest of the track is still to run. */
const SEGMENTS: { key: string; statuses: RunStatus[]; fill: string }[] = [
  { key: "completed", statuses: ["completed"], fill: "bg-success" },
  { key: "failed", statuses: ["failed", "interrupted"], fill: "bg-danger" },
  { key: "cancelled", statuses: ["cancelled"], fill: "bg-muted" },
];

const isLive = (batch: Batch) => batch.status === "queued" || batch.status === "running";

/** Recent batches with their progress; picking one filters the runs list. */
export function BatchesPanel({ batches, now, onPick }: { batches: Batch[]; now: number; onPick: (batch: Batch) => void }) {
  const t = useT();
  const { relativeTime } = useFormat();
  const headingId = "recent-batches";
  return (
    <Card aria-labelledby={headingId}>
      <CardHeader id={headingId} title={t("runs.recentBatches")} />
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3">
        {batches.map((batch) => {
          const name = batchName(t, batch);
          const finished = finishedCount(batch);
          const live = isLive(batch);
          return (
            <li
              key={batch.id}
              aria-label={name}
              className="flex flex-col gap-3 rounded-[10px] border border-line-soft bg-raised p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => onPick(batch)}
                    className={cn("truncate rounded text-left text-sm font-semibold hover:underline", focusRing)}
                  >
                    {name}
                  </button>
                  <span className="font-mono text-xs text-dim">{shortId(batch.id)}</span>
                </div>
                {live ? (
                  <Badge tone="evaluator">
                    <LiveDot />
                    {t("runs.inProgress")}
                  </Badge>
                ) : null}
              </div>
              <div
                role="progressbar"
                aria-label={t("runs.batchProgress", { name })}
                aria-valuemin={0}
                aria-valuemax={batch.total}
                aria-valuenow={finished}
                className="flex h-1.5 gap-0.5 overflow-hidden rounded-[3px] bg-field-border"
              >
                {SEGMENTS.map((segment) => {
                  const value = segment.statuses.reduce((sum, status) => sum + (batch.counts[status] ?? 0), 0);
                  return value > 0 ? (
                    <span key={segment.key} data-segment={segment.key} className={segment.fill} style={{ width: `${(value / batch.total) * 100}%` }} />
                  ) : null;
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span className="flex items-center gap-2">
                  <span>{t("runs.finishedOf", { finished, total: batch.total })}</span>
                  <span aria-hidden="true">·</span>
                  <span>{relativeTime(batch.createdAt, now)}</span>
                </span>
                {live ? (
                  <Link
                    href={`/live?batchId=${encodeURIComponent(batch.id)}`}
                    aria-label={t("runs.watchBatchLive", { name })}
                    className={buttonClasses("secondary", "min-h-9 px-3 text-[13px]")}
                  >
                    {t("runs.live")}
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
