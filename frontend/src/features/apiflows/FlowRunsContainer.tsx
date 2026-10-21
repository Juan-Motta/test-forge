"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useNow } from "@/lib/time/use-now";
import { Alert, Button, EmptyState, Field, RunsIcon, Select, Spinner, buttonClasses } from "@/ui";
import { FlowRunsList } from "./FlowRunsList";
import { useAllFlowRuns, useApis } from "./queries";
import type { RunStatus } from "./types";

export const FLOW_RUNS_PAGE_SIZE = 20;
const STATUSES = ["passed", "failed"] as const satisfies readonly RunStatus[];

type Filters = { status: RunStatus | ""; apiId: string; page: number };

function filtersFrom(params: URLSearchParams): Filters {
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? "1");
  return {
    status: (STATUSES as readonly string[]).includes(status) ? (status as RunStatus) : "",
    apiId: params.get("apiId") ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

function hrefOf(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.apiId) params.set("apiId", filters.apiId);
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/flow-runs?${query}` : "/flow-runs";
}

/**
 * Container for `/flow-runs`: every run of every API flow, newest first, filtered by status and
 * API. The filters and the page are kept in the URL, like `/runs`.
 */
export function FlowRunsContainer() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Filters live in state (seeded from the URL) and are mirrored into the URL for sharing. A URL
  // changed from elsewhere (a link to `/flow-runs?…` while this page is kept alive) wins.
  const search = searchParams.toString();
  const [syncedSearch, setSyncedSearch] = useState(search);
  const [filters, setFilters] = useState<Filters>(() => filtersFrom(new URLSearchParams(search)));
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setFilters(filtersFrom(new URLSearchParams(search)));
  }
  const now = useNow(5000);
  const apis = useApis();
  const runs = useAllFlowRuns({
    status: filters.status || undefined,
    apiId: filters.apiId || undefined,
    limit: FLOW_RUNS_PAGE_SIZE,
    offset: (filters.page - 1) * FLOW_RUNS_PAGE_SIZE,
  });

  // The URL follows a page clamped during render (below); a fresh object per clamp re-runs it.
  const [urlFix, setUrlFix] = useState<{ href: string } | null>(null);
  useEffect(() => {
    if (urlFix) router.replace(urlFix.href, { scroll: false });
  }, [urlFix, router]);

  function update(changes: Partial<Filters>) {
    const next = { ...filters, page: 1, ...changes };
    setFilters(next);
    router.replace(hrefOf(next), { scroll: false });
  }

  const total = runs.data?.total ?? 0;
  // A `?page=` past the end (a stale link, or runs deleted since) moves to the last page.
  const lastPage = Math.max(1, Math.ceil(total / FLOW_RUNS_PAGE_SIZE));
  if (runs.data !== undefined && !runs.isPlaceholderData && filters.page > lastPage) {
    const clamped = { ...filters, page: lastPage };
    setFilters(clamped);
    setUrlFix({ href: hrefOf(clamped) });
  }
  const first = total === 0 ? 0 : (filters.page - 1) * FLOW_RUNS_PAGE_SIZE + 1;
  const last = Math.min(total, filters.page * FLOW_RUNS_PAGE_SIZE);
  const filtered = Boolean(filters.status || filters.apiId);

  let body;
  if (runs.isPending) {
    body = <Spinner label={t("flowRunsPage.loading")} />;
  } else if (runs.isError) {
    body = (
      <Alert title={t("flowRunsPage.loadFailed")}>
        <span className="block">{errorMessage(runs.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => runs.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if (total === 0) {
    body = filtered ? (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-strong bg-panel p-5">
        <p className="text-sm text-muted">{t("runs.noMatch")}</p>
        <Button variant="secondary" onClick={() => update({ status: "", apiId: "" })}>
          {t("common.clearFilters")}
        </Button>
      </div>
    ) : (
      <EmptyState
        icon={<RunsIcon size={22} />}
        title={t("flowRunsPage.emptyTitle")}
        description={t("flowRunsPage.emptyDescription")}
        action={
          <Link href="/flows" className={buttonClasses("secondary")}>
            {t("flowRunsPage.openFlows")}
          </Link>
        }
      />
    );
  } else {
    body = (
      <>
        <FlowRunsList runs={runs.data.items} now={now} />
        <nav aria-label={t("common.pagination")} className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{t("common.range", { first, last, total })}</span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={filters.page <= 1}
              onClick={() => update({ page: filters.page - 1 })}
              aria-label={t("common.previousPage")}
            >
              {t("common.previous")}
            </Button>
            <Button
              variant="secondary"
              disabled={last >= total}
              onClick={() => update({ page: filters.page + 1 })}
              aria-label={t("common.nextPage")}
            >
              {t("common.next")}
            </Button>
          </div>
        </nav>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("nav.groupRuns")} description={t("flowRunsPage.description")} />
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full sm:w-48">
          <Field label={t("runs.filter.status")}>
            {(props) => (
              <Select
                {...props}
                value={filters.status}
                onChange={(event) => update({ status: event.target.value as RunStatus | "" })}
              >
                <option value="">{t("runs.filter.allStatuses")}</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`flowRuns.status.${status}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="w-full sm:w-64">
          <Field label={t("flowsPage.column.api")}>
            {(props) => (
              <Select {...props} value={filters.apiId} onChange={(event) => update({ apiId: event.target.value })}>
                <option value="">{t("flowsPage.allApis")}</option>
                {(apis.data ?? []).map((api) => (
                  <option key={api.id} value={api.id}>
                    {api.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
      {body}
    </>
  );
}
