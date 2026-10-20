"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAgents } from "@/features/agents/queries";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, ApiFlowsIcon, Button, EmptyState, Field, PlusIcon, SearchField, Select, Spinner } from "@/ui";
import { ApiTable, apiHref } from "./ApiTable";
import { NewApiDialog } from "./NewApiDialog";
import { useApis } from "./queries";
import type { Api } from "./types";

/** APIs per page, like the scenario groups. */
const APIS_PER_PAGE = 20;

type ApiFilters = { search: string; agentId: string; tag: string };
const NO_FILTERS: ApiFilters = { search: "", agentId: "", tag: "" };

/** The APIs matching every filter: search in name, base URL, description or tags; one agent; one tag. */
function filterApis(apis: Api[], { search, agentId, tag }: ApiFilters): Api[] {
  const wanted = search.trim().toLowerCase();
  return apis.filter(
    (api) =>
      (!wanted ||
        api.name.toLowerCase().includes(wanted) ||
        api.baseUrl.toLowerCase().includes(wanted) ||
        api.description.toLowerCase().includes(wanted) ||
        api.tags.some((item) => item.toLowerCase().includes(wanted))) &&
      (!agentId || api.agents.some((agent) => agent.id === agentId)) &&
      (!tag || api.tags.includes(tag)),
  );
}

/** `/apis`: the APIs, one row each. A name opens the API: its connection, tags and flows. */
export function ApisContainer() {
  const t = useT();
  const router = useRouter();
  const apis = useApis();
  const agents = useAgents();
  const [creating, setCreating] = useState(false);
  const [filters, setFiltersState] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  // Any filter change starts over on the first page.
  const setFilters = (next: ApiFilters | ((current: ApiFilters) => ApiFilters)) => {
    setFiltersState(next);
    setPage(1);
  };

  const agentList = agents.data ?? [];
  const newApi = (
    <Button icon={<PlusIcon size={16} />} onClick={() => setCreating(true)}>
      {t("apis.new")}
    </Button>
  );

  let body;
  if (apis.isPending) {
    body = <Spinner label={t("apis.loading")} />;
  } else if (apis.isError) {
    body = (
      <Alert title={t("apis.loadFailed")}>
        <span className="block">{errorMessage(apis.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => apis.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if (apis.data.length === 0) {
    body = (
      <EmptyState
        icon={<ApiFlowsIcon size={22} />}
        title={t("apis.emptyTitle")}
        description={t("apis.emptyDescription")}
        action={newApi}
      />
    );
  } else {
    const tags = [...new Set(apis.data.flatMap((api) => api.tags))].sort((a, b) => a.localeCompare(b));
    // A chosen tag or agent that no longer exists (e.g. after a refetch) filters nothing out.
    const active: ApiFilters = {
      ...filters,
      tag: tags.includes(filters.tag) ? filters.tag : "",
      agentId: agentList.some((agent) => agent.id === filters.agentId) ? filters.agentId : "",
    };
    const matching = filterApis(apis.data, active);
    const lastPage = Math.max(1, Math.ceil(matching.length / APIS_PER_PAGE));
    const current = Math.min(page, lastPage);
    const shown = matching.slice((current - 1) * APIS_PER_PAGE, current * APIS_PER_PAGE);
    const first = matching.length === 0 ? 0 : (current - 1) * APIS_PER_PAGE + 1;
    const last = Math.min(matching.length, current * APIS_PER_PAGE);
    body = (
      <>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex w-full flex-col gap-1.5 sm:w-72">
            {/* Seen like the other filters' labels; the field's own (hidden) label names it. */}
            <span aria-hidden="true" className="text-xs font-medium text-muted">
              {t("groups.searchLabel")}
            </span>
            <SearchField
              label={t("apis.search")}
              placeholder={t("apis.searchPlaceholder")}
              value={filters.search}
              onChange={(event) => setFilters((value) => ({ ...value, search: event.target.value }))}
            />
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
                  {agentList.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="w-full sm:w-48">
            <Field label={t("groups.filterTag")}>
              {(props) => (
                <Select
                  {...props}
                  value={active.tag}
                  onChange={(event) => setFilters((value) => ({ ...value, tag: event.target.value }))}
                >
                  <option value="">{t("groups.allTags")}</option>
                  {tags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
        {matching.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-strong bg-panel p-5">
            <p className="text-sm text-muted">{t("apis.noMatch")}</p>
            <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
              {t("common.clearFilters")}
            </Button>
          </div>
        ) : (
          <ApiTable apis={shown} />
        )}
        {matching.length > 0 ? (
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
        ) : null}
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("nav.apis")} description={t("apis.description")} actions={newApi} />
      {body}
      {creating ? (
        <NewApiDialog
          onClose={() => setCreating(false)}
          onCreated={(api) => {
            setCreating(false);
            router.push(apiHref(api));
          }}
        />
      ) : null}
    </>
  );
}
