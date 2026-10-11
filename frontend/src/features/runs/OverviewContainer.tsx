"use client";

import Link from "next/link";
import { relativeTime } from "@/features/connections/format";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useNow } from "@/lib/time/use-now";
import { Alert, Card, CardHeader, EmptyState, OverviewIcon, Spinner, buttonClasses, cn, focusRing } from "@/ui";
import { useRuns } from "./queries";
import { RunStatusChip } from "./RunStatusChip";

const POLL_MS = 5000;
const ONE = { limit: 1 } as const;

/** Container for `/`: cheap run counts (list totals) and the latest runs. Nothing is estimated. */
export function OverviewContainer() {
  const now = useNow(30_000);
  const latest = useRuns({ limit: 5 }, { pollActiveMs: POLL_MS });
  const queued = useRuns({ ...ONE, status: "queued" }, { refetchInterval: POLL_MS });
  const connecting = useRuns({ ...ONE, status: "connecting" }, { refetchInterval: POLL_MS });
  const running = useRuns({ ...ONE, status: "running" }, { refetchInterval: POLL_MS });
  const failed = useRuns({ ...ONE, status: "failed" }, { refetchInterval: POLL_MS });

  const counts = [queued, connecting, running, failed];
  const activeQueries = [queued, connecting, running];
  // A count that failed (with nothing loaded before) is unknown: "—", never a misleading 0.
  const active = activeQueries.every((query) => query.data !== undefined)
    ? activeQueries.reduce((sum, query) => sum + (query.data?.total ?? 0), 0)
    : null;
  const stats = [
    { label: "Active now", value: active, href: "/live" },
    { label: "Runs recorded", value: latest.data?.total ?? null, href: "/runs" },
    { label: "Failed", value: failed.data?.total ?? null, href: "/runs?status=failed" },
  ];
  const countError = counts.find((query) => query.isError)?.error;

  let body;
  if (latest.isPending || counts.some((query) => query.isPending)) {
    body = <Spinner label="Loading overview" />;
  } else if (latest.isError) {
    body = <Alert title="Could not load runs">{errorMessage(latest.error)}</Alert>;
  } else if ((latest.data?.total ?? 0) === 0) {
    body = (
      <EmptyState
        icon={<OverviewIcon size={22} />}
        title="No runs yet"
        description="Launch a scenario against an agent: active calls, recorded runs and failures will show up here."
        action={
          <Link href="/scenarios" className={buttonClasses("primary")}>
            Go to scenarios
          </Link>
        }
      />
    );
  } else {
    body = (
      <>
        {countError ? <Alert title="Some counts could not be loaded">{errorMessage(countError)}</Alert> : null}
        <ul aria-label="Run counts" className="grid gap-4 sm:grid-cols-3">
          {stats.map((stat) => (
            <li key={stat.label} aria-label={stat.label}>
              <Link
                href={stat.href}
                className={cn("flex flex-col gap-1 rounded-xl border border-line bg-panel p-5 hover:bg-raised", focusRing)}
              >
                <span className="text-xs text-muted">{stat.label}</span>
                <span className="font-mono text-3xl font-semibold">{stat.value ?? "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Card aria-labelledby="latest-runs">
          <CardHeader
            id="latest-runs"
            title="Latest runs"
            actions={
              <Link href="/runs" className={cn("rounded text-sm text-muted hover:text-fg", focusRing)}>
                All runs
              </Link>
            }
          />
          <ul className="flex flex-col divide-y divide-line-soft">
            {(latest.data?.items ?? []).map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <Link
                  href={`/runs/${encodeURIComponent(run.id)}`}
                  className={cn("flex min-w-0 flex-col rounded", focusRing)}
                >
                  <span className="truncate text-sm font-medium">{run.scenarioName}</span>
                  <span className="text-xs text-muted">{run.agentName}</span>
                </Link>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span>{relativeTime(run.createdAt, now)}</span>
                  <RunStatusChip status={run.status} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Overview" description="Your evaluation runs at a glance." />
      {body}
    </>
  );
}
