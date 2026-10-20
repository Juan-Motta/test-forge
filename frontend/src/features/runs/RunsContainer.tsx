"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAllFlowRuns, useApis } from "@/features/apiflows/queries";
import type { RunStatus as FlowRunStatus } from "@/features/apiflows/types";
import { PageHeader } from "@/features/shell/PageHeader";
import { useScenarios } from "@/features/scenarios/queries";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useNow } from "@/lib/time/use-now";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  RunsIcon,
  SegmentedControl,
  Select,
  Spinner,
  buttonClasses,
} from "@/ui";
import { batchName } from "./batch-name";
import { statusLabel } from "./format";
import { useBatch, useBatches, useRuns } from "./queries";
import { RunCards } from "./RunCards";
import { MERGE_CAP, mergeRuns, type RunEntry } from "./run-entries";
import { RunEntriesList } from "./RunEntriesList";
import { RunsTable } from "./RunsTable";
import { RUN_STATUSES, type RunOrder, type RunStatus } from "./types";

export const PAGE_SIZE = 20;
const POLL_MS = 4000;

const ORDERS = [
  { value: "newest", label: "runs.order.newest" },
  { value: "oldest", label: "runs.order.oldest" },
] as const satisfies readonly { value: RunOrder; label: string }[];

/** Which runs the page lists: agent runs (the default), API flow runs, or both. */
type RunType = "all" | "agents" | "flows";
const TYPES = [
  { value: "all", label: "runs.type.all" },
  { value: "agents", label: "runs.type.agents" },
  { value: "flows", label: "runs.type.flows" },
] as const satisfies readonly { value: RunType; label: string }[];
const FLOW_STATUSES = ["passed", "failed"] as const satisfies readonly FlowRunStatus[];

/**
 * The page's filters. Status, scenario, batch and order apply to agent runs; flow status (in the
 * same `status` parameter) and API to flow runs; the "All" view has no filter but the type.
 */
type Filters = {
  type: RunType;
  status: RunStatus | "";
  flowStatus: FlowRunStatus | "";
  apiId: string;
  scenarioId: string;
  batchId: string;
  order: RunOrder;
  page: number;
};

const NO_FILTERS = { status: "", flowStatus: "", apiId: "", scenarioId: "", batchId: "", order: "newest" } as const;

function filtersFrom(params: URLSearchParams): Filters {
  const type = params.get("type");
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? "1");
  const base = { page: Number.isInteger(page) && page > 0 ? page : 1 };
  if (type === "all") return { ...NO_FILTERS, ...base, type };
  if (type === "flows") {
    return {
      ...NO_FILTERS,
      ...base,
      type,
      flowStatus: (FLOW_STATUSES as readonly string[]).includes(status) ? (status as FlowRunStatus) : "",
      apiId: params.get("apiId") ?? "",
    };
  }
  return {
    ...NO_FILTERS,
    ...base,
    type: "agents",
    status: (RUN_STATUSES as readonly string[]).includes(status) ? (status as RunStatus) : "",
    scenarioId: params.get("scenarioId") ?? "",
    batchId: params.get("batchId") ?? "",
    order: params.get("order") === "oldest" ? "oldest" : "newest",
  };
}

function hrefOf(filters: Filters): string {
  const params = new URLSearchParams();
  // Agent runs are the default, so their URL stays as it was before there were types.
  if (filters.type !== "agents") params.set("type", filters.type);
  if (filters.type === "agents") {
    if (filters.status) params.set("status", filters.status);
    if (filters.scenarioId) params.set("scenarioId", filters.scenarioId);
    if (filters.batchId) params.set("batchId", filters.batchId);
    if (filters.order !== "newest") params.set("order", filters.order);
  }
  if (filters.type === "flows") {
    if (filters.flowStatus) params.set("status", filters.flowStatus);
    if (filters.apiId) params.set("apiId", filters.apiId);
  }
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/runs?${query}` : "/runs";
}

/**
 * Container for `/runs`: every run, newest (or oldest) first, filtered by status, scenario and
 * batch. Wide screens get the runs table; narrower ones the same runs as cards. The Type filter
 * switches to API flow runs (filtered by status and API), or to both kinds merged newest first.
 */
export function RunsContainer() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Filters live in state (seeded from the URL) and are mirrored into the URL for sharing. A URL
  // changed from elsewhere (a link to `/runs?…` while this page is kept alive) wins.
  const search = searchParams.toString();
  const [syncedSearch, setSyncedSearch] = useState(search);
  const [filters, setFilters] = useState<Filters>(() => filtersFrom(new URLSearchParams(search)));
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setFilters(filtersFrom(new URLSearchParams(search)));
  }
  const now = useNow(5000);
  const scenarios = useScenarios();
  const batches = useBatches({ limit: 20 }, { refetchInterval: POLL_MS });
  const batch = useBatch(filters.batchId || undefined);
  const { type } = filters;
  // "All" reads the newest runs of each kind up to the current page (at most MERGE_CAP of each).
  const mergeLimit = Math.min(filters.page * PAGE_SIZE, MERGE_CAP);
  const runs = useRuns(
    type === "all"
      ? { limit: mergeLimit, offset: 0 }
      : {
          status: filters.status || undefined,
          scenarioId: filters.scenarioId || undefined,
          batchId: filters.batchId || undefined,
          order: filters.order === "newest" ? undefined : filters.order,
          limit: PAGE_SIZE,
          offset: (filters.page - 1) * PAGE_SIZE,
        },
    { pollActiveMs: POLL_MS, enabled: type !== "flows" },
  );
  const flowRuns = useAllFlowRuns(
    type === "all"
      ? { limit: mergeLimit, offset: 0 }
      : {
          status: filters.flowStatus || undefined,
          apiId: filters.apiId || undefined,
          limit: PAGE_SIZE,
          offset: (filters.page - 1) * PAGE_SIZE,
        },
    { enabled: type !== "agents" },
  );
  const apis = useApis({ enabled: type === "flows" });
  // The queries this type shows.
  const shown = type === "agents" ? [runs] : type === "flows" ? [flowRuns] : [runs, flowRuns];

  const items = runs.data?.items ?? [];
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


  const agentTotal = runs.data?.total ?? 0;
  const flowTotal = flowRuns.data?.total ?? 0;
  const total =
    type === "agents"
      ? agentTotal
      : type === "flows"
        ? flowTotal
        : Math.min(agentTotal, MERGE_CAP) + Math.min(flowTotal, MERGE_CAP);
  const capped = type === "all" && (agentTotal > MERGE_CAP || flowTotal > MERGE_CAP);
  const loaded = shown.every((query) => query.data !== undefined && !query.isPlaceholderData);
  // A `?page=` past the end (a stale link, or runs deleted since) moves to the last page.
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const outOfRange = loaded && filters.page > lastPage;
  if (outOfRange) {
    const clamped = { ...filters, page: lastPage };
    setFilters(clamped);
    setUrlFix({ href: hrefOf(clamped) });
  }
  const first = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(total, filters.page * PAGE_SIZE);
  const filtered =
    type === "agents"
      ? Boolean(filters.status || filters.scenarioId || filters.batchId)
      : type === "flows" && Boolean(filters.flowStatus || filters.apiId);
  const entries: RunEntry[] =
    type === "flows"
      ? (flowRuns.data?.items ?? []).map((run) => ({ kind: "flow", run }))
      : type === "all"
        ? mergeRuns(items, flowRuns.data?.items ?? []).slice((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE)
        : [];
  const failedQuery = shown.find((query) => query.isError);
  // The recent batches, plus the filtered one when it is older (e.g. opened from a run report).
  const recent = batches.data?.items ?? [];
  const batchOptions: { id: string; label: string | null }[] =
    filters.batchId && !recent.some((item) => item.id === filters.batchId)
      ? [...recent, batch.data ?? { id: filters.batchId, label: null }]
      : recent;

  let body;
  if (shown.some((query) => query.isPending) || (type === "all" && !loaded && entries.length === 0 && total > 0)) {
    body = <Spinner label={t("runs.loading")} />;
  } else if (failedQuery) {
    body = (
      <Alert title={t("runs.loadFailed")}>
        <span className="block">{errorMessage(failedQuery.error)}</span>
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => shown.forEach((query) => query.isError && query.refetch())}
        >
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if (total === 0) {
    body = filtered ? (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-strong bg-panel p-5">
        <p className="text-sm text-muted">{t("runs.noMatch")}</p>
        <Button variant="secondary" onClick={() => update({ status: "", scenarioId: "", batchId: "", flowStatus: "", apiId: "" })}>
          {t("common.clearFilters")}
        </Button>
      </div>
    ) : type === "flows" ? (
      <EmptyState
        icon={<RunsIcon size={22} />}
        title={t("runs.flowsEmptyTitle")}
        description={t("runs.flowsEmptyDescription")}
      />
    ) : (
      <EmptyState
        icon={<RunsIcon size={22} />}
        title={t("runs.emptyTitle")}
        description={t("runs.emptyDescription")}
      />
    );
  } else {
    body = (
      <>
        {capped ? <p className="text-sm text-muted">{t("runs.capped", { max: MERGE_CAP })}</p> : null}
        {type === "agents" ? (
          <>
            {/* One of the two shows at a time (CSS), so the hidden one is out of the a11y tree too. */}
            <RunsTable
              runs={items}
              now={now}
              className="hidden xl:block"
            />
            <RunCards
              runs={items}
              now={now}
              className="xl:hidden"
            />
          </>
        ) : (
          <RunEntriesList
            entries={entries}
            now={now}
            label={type === "flows" ? t("runs.flowRunsLabel") : t("runs.listLabel")}
            showSteps={type === "flows"}
          />
        )}
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
      <PageHeader
        title={t("nav.runs")}
        description={t("runs.description")}
        actions={
          <Link href="/live" className={buttonClasses("secondary")}>
            {t("nav.live")}
          </Link>
        }
      />
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full sm:w-40">
          <Field label={t("runs.filter.type")}>
            {(props) => (
              <Select
                {...props}
                value={type}
                onChange={(event) => update({ ...NO_FILTERS, type: event.target.value as RunType })}
              >
                {TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.label)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {type === "agents" ? (
          <>
        <div className="w-full sm:w-48">
          <Field label={t("runs.filter.status")}>
            {(props) => (
              <Select
                {...props}
                value={filters.status}
                onChange={(event) => update({ status: event.target.value as RunStatus | "" })}
              >
                <option value="">{t("runs.filter.allStatuses")}</option>
                {RUN_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(t, status)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="w-full sm:w-64">
          <Field label={t("runs.column.scenario")}>
            {(props) => (
              <Select {...props} value={filters.scenarioId} onChange={(event) => update({ scenarioId: event.target.value })}>
                <option value="">{t("runs.filter.allScenarios")}</option>
                {(scenarios.data ?? []).map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="w-full sm:w-64">
          <Field label={t("runs.filter.batch")}>
            {(props) => (
              <Select {...props} value={filters.batchId} onChange={(event) => update({ batchId: event.target.value })}>
                <option value="">{t("runs.filter.allBatches")}</option>
                {batchOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {batchName(t, option)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <SegmentedControl
          size="md"
          label={t("runs.filter.order")}
          options={ORDERS.map((order) => ({ value: order.value, label: t(order.label) }))}
          value={filters.order}
          onChange={(order) => update({ order })}
        />
          </>
        ) : null}
        {type === "flows" ? (
          <>
            <div className="w-full sm:w-48">
              <Field label={t("runs.filter.status")}>
                {(props) => (
                  <Select
                    {...props}
                    value={filters.flowStatus}
                    onChange={(event) => update({ flowStatus: event.target.value as FlowRunStatus | "" })}
                  >
                    <option value="">{t("runs.filter.allStatuses")}</option>
                    {FLOW_STATUSES.map((status) => (
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
          </>
        ) : null}
      </div>
      {body}
    </>
  );
}
