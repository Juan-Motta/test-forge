"use client";

import Link from "next/link";
import { useFormat, useT } from "@/lib/i18n";
import { Badge, cn, focusRing } from "@/ui";
import { runHref } from "./ApiTable";
import { useFlowRuns } from "./queries";
import { formatDuration } from "./run-view";
import type { Api, FlowRun } from "./types";

type RecentRunsListProps = { api: Pick<Api, "id">; runs: FlowRun[] | undefined; failed: boolean };

/** The flow's latest runs, newest first, each opening its run view. */
export function RecentRunsList({ api, runs, failed }: RecentRunsListProps) {
  const t = useT();
  const format = useFormat();
  let body;
  if (failed) body = <p className="text-xs text-muted">{t("flowRuns.recentFailed")}</p>;
  else if (runs === undefined) body = <p className="text-xs text-muted">{t("flowRuns.recentLoading")}</p>;
  else if (runs.length === 0) body = <p className="text-xs text-muted">{t("flowRuns.recentEmpty")}</p>;
  else
    body = (
      <ul className="flex flex-col gap-0.5">
        {runs.map((run) => (
          <li key={run.id}>
            <Link
              href={runHref(api, run.flowId, run.id)}
              className={cn("flex min-h-9 flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-fg hover:bg-active", focusRing)}
            >
              <Badge tone={run.status === "passed" ? "success" : "danger"}>{t(`flowRuns.status.${run.status}`)}</Badge>
              <span className="font-mono text-muted">{formatDuration(run.durationMs, format.number)}</span>
              <time dateTime={run.createdAt} title={format.absoluteTime(run.createdAt)} className="text-muted">
                {format.relativeTime(run.createdAt)}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    );
  return (
    <section aria-label={t("flowRuns.recent")} className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted">{t("flowRuns.recent")}</h3>
      {body}
    </section>
  );
}

/** Recent runs of a stored flow. */
export function RecentRuns({ api, flowId }: { api: Pick<Api, "id">; flowId: string }) {
  const runs = useFlowRuns(flowId);
  return <RecentRunsList api={api} runs={runs.data} failed={runs.isError && runs.data === undefined} />;
}
