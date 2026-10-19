"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAgents } from "@/features/agents/queries";
import { LaunchRunsDialog } from "@/features/runs/LaunchRunsDialog";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  ImportIcon,
  PlusIcon,
  ScenariosIcon,
  SearchField,
  Select,
  Spinner,
  buttonClasses,
  cn,
  focusRing,
} from "@/ui";
import { GroupTable } from "./GroupTable";
import { useGroups, useScenarios } from "./queries";
import type { Scenario, ScenarioGroup } from "./types";

const NO_AGENT_HINT_ID = "new-scenario-needs-agent";

/** Groups per page, like the runs list. */
const GROUPS_PER_PAGE = 20;

type GroupFilters = { search: string; agentId: string; tag: string };
const NO_FILTERS: GroupFilters = { search: "", agentId: "", tag: "" };

/** The groups matching every filter: search in title, description or tags; one agent; one tag. */
function filterGroups(groups: ScenarioGroup[], { search, agentId, tag }: GroupFilters): ScenarioGroup[] {
  const wanted = search.trim().toLowerCase();
  return groups.filter(
    (group) =>
      (!wanted ||
        group.name.toLowerCase().includes(wanted) ||
        group.description.toLowerCase().includes(wanted) ||
        group.tags.some((item) => item.toLowerCase().includes(wanted))) &&
      (!agentId || group.agents.some((agent) => agent.id === agentId)) &&
      (!tag || group.tags.includes(tag)),
  );
}

/**
 * `/scenarios`: the scenario groups, one row each. A group's title opens it: its header (edited
 * in place) over its scenarios in the sidebar. "New scenario" opens the editor on a new group,
 * created on save.
 */
export function ScenariosContainer() {
  const t = useT();
  const router = useRouter();
  const groups = useGroups();
  const scenarios = useScenarios();
  const agents = useAgents();
  const [launching, setLaunching] = useState<Scenario[] | undefined>(undefined);
  const [filters, setFiltersState] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  // Any filter change starts over on the first page.
  const setFilters = (next: GroupFilters | ((current: GroupFilters) => GroupFilters)) => {
    setFiltersState(next);
    setPage(1);
  };

  const agentList = agents.data ?? [];
  const noAgents = agents.isSuccess && agentList.length === 0;

  // A new scenario outside any group starts a new group (titled in the editor).
  const newScenario = noAgents ? (
    <Button icon={<PlusIcon size={16} />} disabled aria-describedby={NO_AGENT_HINT_ID}>
      {t("scenarios.new")}
    </Button>
  ) : (
    <Link href="/scenarios/new" className={buttonClasses("primary")}>
      <PlusIcon size={16} />
      {t("scenarios.new")}
    </Link>
  );
  // Opens a new scenario with the import panel (see ScenarioEditor); hidden until an agent exists.
  const importScenario = noAgents ? null : (
    <Link href="/scenarios/new#import" className={buttonClasses("secondary")}>
      <ImportIcon size={16} />
      {t("transfer.import")}
    </Link>
  );

  let body;
  if (groups.isPending) {
    body = <Spinner label={t("scenarios.loading")} />;
  } else if (groups.isError) {
    body = (
      <Alert title={t("groups.loadFailed")}>
        <span className="block">{errorMessage(groups.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => groups.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if (groups.data.length === 0) {
    body = (
      <EmptyState
        icon={<ScenariosIcon size={22} />}
        title={t("groups.emptyTitle")}
        description={t("groups.emptyDescription")}
        action={newScenario}
      />
    );
  } else {
    const loaded = scenarios.data;
    const tags = [...new Set(groups.data.flatMap((group) => group.tags))].sort((a, b) => a.localeCompare(b));
    // A chosen tag or agent that no longer exists (e.g. after a refetch) filters nothing out.
    const active: GroupFilters = {
      ...filters,
      tag: tags.includes(filters.tag) ? filters.tag : "",
      agentId: agentList.some((agent) => agent.id === filters.agentId) ? filters.agentId : "",
    };
    const matching = filterGroups(groups.data, active);
    const lastPage = Math.max(1, Math.ceil(matching.length / GROUPS_PER_PAGE));
    const current = Math.min(page, lastPage);
    const shown = matching.slice((current - 1) * GROUPS_PER_PAGE, current * GROUPS_PER_PAGE);
    const first = matching.length === 0 ? 0 : (current - 1) * GROUPS_PER_PAGE + 1;
    const last = Math.min(matching.length, current * GROUPS_PER_PAGE);
    body = (
      <>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex w-full flex-col gap-1.5 sm:w-72">
            {/* Seen like the other filters' labels; the field's own (hidden) label names it. */}
            <span aria-hidden="true" className="text-xs font-medium text-muted">
              {t("groups.searchLabel")}
            </span>
            <SearchField
              label={t("groups.search")}
              placeholder={t("groups.searchPlaceholder")}
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            />
          </div>
          <div className="w-full sm:w-60">
            <Field label={t("common.agent")}>
              {(props) => (
                <Select
                  {...props}
                  value={active.agentId}
                  onChange={(event) => setFilters((current) => ({ ...current, agentId: event.target.value }))}
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
                  onChange={(event) => setFilters((current) => ({ ...current, tag: event.target.value }))}
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
        {scenarios.isError && !loaded ? (
          <Alert title={t("groups.scenariosFailed")}>
            <span className="block">{errorMessage(scenarios.error)}</span>
            <Button variant="secondary" className="mt-3" onClick={() => scenarios.refetch()}>
              {t("common.tryAgain")}
            </Button>
          </Alert>
        ) : null}
        {matching.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-strong bg-panel p-5">
            <p className="text-sm text-muted">{t("groups.noMatch")}</p>
            <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
              {t("common.clearFilters")}
            </Button>
          </div>
        ) : (
          <GroupTable
            groups={shown}
            // Only once the scenarios are known: a launch must never open with an empty batch.
            // They are the ones the group holds now, newest first like the API lists them.
            onLaunch={
              loaded ? (group) => setLaunching(loaded.filter((scenario) => scenario.groupId === group.id)) : undefined
            }
          />
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
      <PageHeader
        title={t("nav.scenarios")}
        description={t("scenarios.description")}
        actions={
          <>
            {importScenario}
            {newScenario}
          </>
        }
      />
      {noAgents ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <p id={NO_AGENT_HINT_ID}>{t("scenarios.noAgentHint")}</p>
          <Link href="/agents" className={cn("rounded", focusRing)}>
            {t("scenarios.addAgent")}
          </Link>
        </div>
      ) : null}
      {body}

      <LaunchRunsDialog
        open={launching !== undefined}
        scenarios={(launching ?? []).map(({ id, name, agentId, endConditions }) => ({
          id,
          name,
          maxDurationS: endConditions.maxDurationS,
          kind: agentList.find((agent) => agent.id === agentId)?.kind,
        }))}
        onClose={() => setLaunching(undefined)}
        onLaunched={(batch) => router.push(`/live?batchId=${encodeURIComponent(batch.id)}`)}
      />
    </>
  );
}
