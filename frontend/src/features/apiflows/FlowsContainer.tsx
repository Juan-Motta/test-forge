"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, ApiFlowsIcon, Button, EmptyState, Field, SearchField, Select, Spinner, buttonClasses } from "@/ui";
import { FlowsTable } from "./FlowsTable";
import { useAllFlows } from "./queries";
import type { Flow, NamedRef } from "./types";

/** Flows per page, like the APIs. */
const FLOWS_PER_PAGE = 20;

type FlowFilters = { search: string; apiId: string; agentId: string };
const NO_FILTERS: FlowFilters = { search: "", apiId: "", agentId: "" };

/** The flows matching every filter: search in name, description or API name; one API; one agent. */
function filterFlows(flows: Flow[], { search, apiId, agentId }: FlowFilters): Flow[] {
  const wanted = search.trim().toLowerCase();
  return flows.filter(
    (flow) =>
      (!wanted ||
        flow.name.toLowerCase().includes(wanted) ||
        flow.description.toLowerCase().includes(wanted) ||
        flow.api.name.toLowerCase().includes(wanted)) &&
      (!apiId || flow.apiId === apiId) &&
      (!agentId || flow.agents.some((agent) => agent.id === agentId)),
  );
}

/** Distinct refs, sorted by name. */
function distinct(refs: NamedRef[]): NamedRef[] {
  return [...new Map(refs.map((ref) => [ref.id, ref])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** `/flows`: every flow of every API, one row each. Flows are created and edited inside their API. */
export function FlowsContainer() {
  const t = useT();
  const flows = useAllFlows();
  const [filters, setFiltersState] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  // Any filter change starts over on the first page.
  const setFilters = (next: FlowFilters | ((current: FlowFilters) => FlowFilters)) => {
    setFiltersState(next);
    setPage(1);
  };

  let body;
  if (flows.isPending) {
    body = <Spinner label={t("flowsPage.loading")} />;
  } else if (flows.isError) {
    body = (
      <Alert title={t("flowsPage.loadFailed")}>
        <span className="block">{errorMessage(flows.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => flows.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if (flows.data.length === 0) {
    body = (
      <EmptyState
        icon={<ApiFlowsIcon size={22} />}
        title={t("flowsPage.emptyTitle")}
        description={t("flowsPage.emptyDescription")}
        action={
          <Link href="/apis" className={buttonClasses("secondary")}>
            {t("flowsPage.goToApis")}
          </Link>
        }
      />
    );
  } else {
    const apis = distinct(flows.data.map((flow) => flow.api));
    const agents = distinct(flows.data.flatMap((flow) => flow.agents));
    // A chosen API or agent that no longer exists (e.g. after a refetch) filters nothing out.
    const active: FlowFilters = {
      ...filters,
      apiId: apis.some((api) => api.id === filters.apiId) ? filters.apiId : "",
      agentId: agents.some((agent) => agent.id === filters.agentId) ? filters.agentId : "",
    };
    const matching = filterFlows(flows.data, active);
    const lastPage = Math.max(1, Math.ceil(matching.length / FLOWS_PER_PAGE));
    const current = Math.min(page, lastPage);
    const shown = matching.slice((current - 1) * FLOWS_PER_PAGE, current * FLOWS_PER_PAGE);
    const first = matching.length === 0 ? 0 : (current - 1) * FLOWS_PER_PAGE + 1;
    const last = Math.min(matching.length, current * FLOWS_PER_PAGE);
    body = (
      <>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex w-full flex-col gap-1.5 sm:w-72">
            {/* Seen like the other filters' labels; the field's own (hidden) label names it. */}
            <span aria-hidden="true" className="text-xs font-medium text-muted">
              {t("groups.searchLabel")}
            </span>
            <SearchField
              label={t("flowsPage.search")}
              placeholder={t("flowsPage.searchPlaceholder")}
              value={filters.search}
              onChange={(event) => setFilters((value) => ({ ...value, search: event.target.value }))}
            />
          </div>
          <div className="w-full sm:w-56">
            <Field label={t("flowsPage.column.api")}>
              {(props) => (
                <Select
                  {...props}
                  value={active.apiId}
                  onChange={(event) => setFilters((value) => ({ ...value, apiId: event.target.value }))}
                >
                  <option value="">{t("flowsPage.allApis")}</option>
                  {apis.map((api) => (
                    <option key={api.id} value={api.id}>
                      {api.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="w-full sm:w-60">
            <Field label={t("common.agent")}>
              {(props) => (
                <Select
                  {...props}
                  value={active.agentId}
                  onChange={(event) => setFilters((value) => ({ ...value, agentId: event.target.value }))}
                >
                  <option value="">{t("groups.allAgents")}</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
        {matching.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-strong bg-panel p-5">
            <p className="text-sm text-muted">{t("flowsPage.noMatch")}</p>
            <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
              {t("common.clearFilters")}
            </Button>
          </div>
        ) : (
          <>
            <FlowsTable flows={shown} />
            <nav aria-label={t("common.pagination")} className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
              <span>{t("common.range", { first, last, total: matching.length })}</span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={current <= 1}
                  onClick={() => setPage(current - 1)}
                  aria-label={t("common.previousPage")}
                >
                  {t("common.previous")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={current >= lastPage}
                  onClick={() => setPage(current + 1)}
                  aria-label={t("common.nextPage")}
                >
                  {t("common.next")}
                </Button>
              </div>
            </nav>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.flows")}
        description={t("flowsPage.description")}
      />
      {body}
    </>
  );
}
