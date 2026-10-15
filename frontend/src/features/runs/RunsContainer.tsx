"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { useScenarios } from "@/features/scenarios/queries";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useNow } from "@/lib/time/use-now";
import {
  Alert,
  Button,
  CloseIcon,
  EmptyState,
  Field,
  RunsIcon,
  SegmentedControl,
  Select,
  Spinner,
  buttonClasses,
  cn,
  focusRing,
} from "@/ui";
import { BatchesPanel, batchName } from "./BatchesPanel";
import { statusLabel } from "./format";
import { useBatch, useBatches, useCancelRun, useRuns } from "./queries";
import { RunCards } from "./RunCards";
import { RunsTable } from "./RunsTable";
import { RUN_STATUSES, type Run, type RunOrder, type RunStatus } from "./types";

export const PAGE_SIZE = 20;
const POLL_MS = 4000;

const ORDERS = [
  { value: "newest", label: "runs.order.newest" },
  { value: "oldest", label: "runs.order.oldest" },
] as const satisfies readonly { value: RunOrder; label: string }[];

type Filters = { status: RunStatus | ""; scenarioId: string; batchId: string; order: RunOrder; page: number };

function filtersFrom(params: URLSearchParams): Filters {
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? "1");
  return {
    status: (RUN_STATUSES as readonly string[]).includes(status) ? (status as RunStatus) : "",
    scenarioId: params.get("scenarioId") ?? "",
    batchId: params.get("batchId") ?? "",
    order: params.get("order") === "oldest" ? "oldest" : "newest",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

function hrefOf(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.scenarioId) params.set("scenarioId", filters.scenarioId);
  if (filters.batchId) params.set("batchId", filters.batchId);
  if (filters.order !== "newest") params.set("order", filters.order);
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/runs?${query}` : "/runs";
}

/**
 * Container for `/runs`: every run, newest (or oldest) first, filtered by status, scenario and
 * batch. Wide screens get the runs table; narrower ones the same runs as cards.
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
  const batches = useBatches({ limit: 5 }, { refetchInterval: POLL_MS });
  const batch = useBatch(filters.batchId || undefined);
  const cancel = useCancelRun();
  const runs = useRuns(
    {
      status: filters.status || undefined,
      scenarioId: filters.scenarioId || undefined,
      batchId: filters.batchId || undefined,
      order: filters.order === "newest" ? undefined : filters.order,
      limit: PAGE_SIZE,
      offset: (filters.page - 1) * PAGE_SIZE,
    },
    { pollActiveMs: POLL_MS },
  );

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

  function onCancel(run: Run) {
    if (cancel.isPending) return;
    cancel.mutate(run.id);
  }

  const total = runs.data?.total ?? 0;
  // A `?page=` past the end (a stale link, or runs deleted since) moves to the last page.
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const outOfRange = runs.data !== undefined && !runs.isPlaceholderData && filters.page > lastPage;
  if (outOfRange) {
    const clamped = { ...filters, page: lastPage };
    setFilters(clamped);
    setUrlFix({ href: hrefOf(clamped) });
  }
  const first = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(total, filters.page * PAGE_SIZE);
  const filtered = Boolean(filters.status || filters.scenarioId || filters.batchId);
  const batchLabel = batch.data
    ? batchName(t, batch.data)
    : filters.batchId
      ? t("runs.batch", { id: filters.batchId.slice(0, 8) })
      : "";

  let body;
  if (runs.isPending) {
    body = <Spinner label={t("runs.loading")} />;
  } else if (runs.isError) {
    body = (
      <Alert title={t("runs.loadFailed")}>
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
        <Button variant="secondary" onClick={() => update({ status: "", scenarioId: "", batchId: "" })}>
          {t("common.clearFilters")}
        </Button>
      </div>
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
        {/* One of the two shows at a time (CSS), so the hidden one is out of the a11y tree too. */}
        <RunsTable
          runs={items}
          now={now}
          onCancel={onCancel}
          cancellingId={cancel.isPending ? cancel.variables : undefined}
          className="hidden xl:block"
        />
        <RunCards
          runs={items}
          now={now}
          onCancel={onCancel}
          cancellingId={cancel.isPending ? cancel.variables : undefined}
          className="xl:hidden"
        />
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
      {batches.data && batches.data.items.length > 0 ? (
        <BatchesPanel batches={batches.data.items} now={now} onPick={(picked) => update({ batchId: picked.id })} />
      ) : null}
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
        <SegmentedControl
          size="md"
          label={t("runs.filter.order")}
          options={ORDERS.map((order) => ({ value: order.value, label: t(order.label) }))}
          value={filters.order}
          onChange={(order) => update({ order })}
        />
        {filters.batchId ? (
          <span className="inline-flex min-h-9 items-center gap-1 rounded-full border border-evaluator bg-evaluator/15 pr-1 pl-3.5 text-xs">
            {batchLabel}
            <button
              type="button"
              aria-label={t("runs.clearBatch", { name: batchLabel })}
              onClick={() => update({ batchId: "" })}
              className={cn("inline-flex size-7 items-center justify-center rounded-full hover:bg-active", focusRing)}
            >
              <CloseIcon size={12} />
            </button>
          </span>
        ) : null}
      </div>
      {cancel.isError ? <Alert>{t("runs.cancelFailed", { error: errorMessage(cancel.error) })}</Alert> : null}
      {body}
    </>
  );
}
