"use client";

import Link from "next/link";
import { useState } from "react";
import { useRuns } from "@/features/runs/queries";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useNow } from "@/lib/time/use-now";
import { Alert, EmptyState, OverviewIcon, PlusIcon, SearchField, Spinner, buttonClasses } from "@/ui";
import { InsightsColumn } from "./InsightsColumn";
import { LiveNowCard } from "./LiveNowCard";
import { OverviewKpis } from "./OverviewKpis";
import { useOverviewStats } from "./queries";
import { RecentRunsCard } from "./RecentRunsCard";

const DAYS = 7;
const POLL_MS = 5000;
const STATS_POLL_MS = 30_000;

/**
 * Container for `/`: the window's metrics (`/api/stats/overview`), the calls in progress and the
 * latest runs. Nothing is estimated: an unknown metric reads "—".
 */
export function OverviewContainer() {
  const now = useNow(5000);
  const [search, setSearch] = useState("");
  const stats = useOverviewStats(DAYS, { refetchInterval: STATS_POLL_MS });
  const recent = useRuns({ limit: 20 }, { pollActiveMs: POLL_MS });
  const live = useRuns({ status: "running", limit: 3 }, { refetchInterval: POLL_MS });

  let body;
  if (recent.isPending || stats.isPending) {
    body = <Spinner label="Loading overview" />;
  } else if (recent.isError) {
    body = <Alert title="Could not load runs">{errorMessage(recent.error)}</Alert>;
  } else if ((recent.data?.total ?? 0) === 0) {
    body = (
      <EmptyState
        icon={<OverviewIcon size={22} />}
        title="No runs yet"
        description="Launch a scenario against an agent: metrics, live calls and recent runs will show up here."
        action={
          <Link href="/scenarios" className={buttonClasses("primary")}>
            Go to scenarios
          </Link>
        }
      />
    );
  } else {
    const liveError = live.isError && live.data === undefined ? errorMessage(live.error) : null;
    body = (
      <>
        {stats.isError ? (
          <Alert title="Some metrics could not be loaded">{errorMessage(stats.error)}</Alert>
        ) : null}
        <OverviewKpis stats={stats.data} />
        <LiveNowCard runs={live.data?.items} total={live.data?.total ?? null} error={liveError} now={now} />
        <div className="flex flex-wrap items-start gap-5">
          <RecentRunsCard runs={recent.data?.items ?? []} search={search} now={now} />
          <InsightsColumn stats={stats.data} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Last ${DAYS} days across all agents`}
        actions={
          <>
            <SearchField
              label="Search runs"
              placeholder="Search runs, scenarios, threads"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full sm:w-72"
            />
            <Link href="/scenarios" className={buttonClasses("primary")}>
              <PlusIcon size={16} strokeWidth={2.2} />
              New run
            </Link>
          </>
        }
      />
      {body}
    </>
  );
}
