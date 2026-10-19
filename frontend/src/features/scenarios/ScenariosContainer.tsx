"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAgents } from "@/features/agents/queries";
import { LaunchRunsDialog } from "@/features/runs/LaunchRunsDialog";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useT, type Translator } from "@/lib/i18n";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  FilterChips,
  PlusIcon,
  ScenariosIcon,
  Select,
  Spinner,
  buttonClasses,
  cn,
  focusRing,
} from "@/ui";
import { DeleteScenarioDialog } from "./DeleteScenarioDialog";
import { allTags, groupScenarios, type LibraryFilters } from "./library";
import { useDeleteScenario, useDuplicateScenario, useScenarios } from "./queries";
import { ScenarioList } from "./ScenarioList";
import type { Scenario } from "./types";

const NO_AGENT_HINT_ID = "new-scenario-needs-agent";
const NO_FILTERS: LibraryFilters = { agentId: "", tag: null };

/** Container for `/scenarios`: the library, filtered by agent and tag in the browser. */
export function ScenariosContainer() {
  const t = useT();
  const router = useRouter();
  const scenarios = useScenarios();
  const agents = useAgents();
  const duplicate = useDuplicateScenario();
  const remove = useDeleteScenario();
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const [deleting, setDeleting] = useState<Scenario | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [launching, setLaunching] = useState<Scenario[] | undefined>(undefined);
  // Refs, not mutation state: two clicks can land before React re-renders the disabled button.
  const duplicatingNow = useRef(false);
  const deletingNow = useRef(false);
  // Mirrors `deletingNow` for rendering: one delete at a time, even across dialogs.
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const shownDelete = useRef<Scenario | undefined>(undefined);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);

  useEffect(() => {
    if (!focusTitle.current || deleting) return;
    focusTitle.current = false;
    titleRef.current?.focus();
  });

  const agentList = agents.data ?? [];
  const noAgents = agents.isSuccess && agentList.length === 0;

  function onDuplicate(scenario: Scenario) {
    if (duplicatingNow.current) return;
    duplicatingNow.current = true;
    duplicate.mutate(scenario, {
      onSuccess: (copy) => router.push(`/scenarios/${encodeURIComponent(copy.id)}`),
      onSettled: () => (duplicatingNow.current = false),
    });
  }

  /** Opens or closes the dialog; the ref lets a settling delete see what the dialog shows now. */
  function showDelete(scenario: Scenario | undefined) {
    shownDelete.current = scenario;
    setDeleting(scenario);
  }

  async function confirmDelete(scenario: Scenario) {
    if (deletingNow.current) return;
    deletingNow.current = true;
    setDeleteInFlight(true);
    try {
      await remove.mutateAsync(scenario);
      setNotice(t("common.deleted", { name: scenario.name }));
      // The user may have cancelled and opened another scenario's dialog meanwhile: leave that one open.
      if (shownDelete.current?.id === scenario.id) {
        focusTitle.current = true;
        showDelete(undefined);
      }
    } catch {
      // Shown through the mutation's error state while its dialog is open.
    } finally {
      // mutateAsync, not mutate's onSettled: `remove.reset()` drops pending mutate callbacks.
      deletingNow.current = false;
      setDeleteInFlight(false);
    }
  }

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
      {t("transfer.import")}
    </Link>
  );

  const list = scenarios.data ?? [];
  const groups = groupScenarios(list, agentList, filters);
  // Only what the filters show, in library order: each launched scenario is a paid run, so a
  // selection hidden by the filters is kept (it comes back with them) but never launched.
  const picked = groups.flatMap((group) => group.scenarios).filter((scenario) => selected.has(scenario.id));
  const hiddenCount = list.filter((scenario) => selected.has(scenario.id)).length - picked.length;

  function toggleSelected(scenario: Scenario) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(scenario.id)) next.delete(scenario.id);
      else next.add(scenario.id);
      return next;
    });
  }

  let body;
  if (scenarios.isPending || agents.isPending) {
    body = <Spinner label={t("scenarios.loading")} />;
  } else if (scenarios.isError || agents.isError) {
    const failed = scenarios.isError ? scenarios : agents;
    body = (
      <Alert title={t("scenarios.loadFailed")}>
        <span className="block">{errorMessage(failed.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => failed.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon={<ScenariosIcon size={22} />}
        title={t("scenarios.emptyTitle")}
        description={t("scenarios.emptyDescription")}
        action={newScenario}
      />
    );
  } else {
    const tags = allTags(list);
    body = (
      <>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full sm:w-64">
            <Field label={t("common.agent")}>
              {(props) => (
                <Select
                  {...props}
                  value={filters.agentId}
                  onChange={(event) => setFilters((current) => ({ ...current, agentId: event.target.value }))}
                >
                  <option value="">{t("scenarios.allAgents")}</option>
                  {agentList.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {tags.length > 0 ? (
            <FilterChips
              label={t("scenarios.filterByTag")}
              size="md"
              options={[{ value: "", label: t("scenarios.allTags") }, ...tags.map((tag) => ({ value: tag, label: tag }))]}
              selected={[filters.tag ?? ""]}
              onToggle={(tag) => setFilters((f) => ({ ...f, tag: tag === "" || f.tag === tag ? null : tag }))}
            />
          ) : null}
        </div>
        {picked.length > 0 || hiddenCount > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-evaluator-line bg-panel px-4 py-3">
            {picked.length > 0 ? (
              <p className="text-sm text-muted">{t.plural("scenarios.selectedCount", picked.length)}</p>
            ) : null}
            {hiddenCount > 0 ? <p className="text-sm text-muted">{hiddenSelectionText(t, hiddenCount, picked.length > 0)}</p> : null}
            {picked.length > 0 ? (
              <Button onClick={() => setLaunching(picked)}>{t("scenarios.launchSelected", { count: picked.length })}</Button>
            ) : null}
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              {t("scenarios.clearSelection")}
            </Button>
          </div>
        ) : null}
        {groups.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-strong bg-panel p-5">
            <p className="text-sm text-muted">{t("scenarios.noMatch")}</p>
            <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
              {t("common.clearFilters")}
            </Button>
          </div>
        ) : (
          <ScenarioList
            groups={groups}
            onDuplicate={onDuplicate}
            onDelete={(scenario) => {
              remove.reset();
              showDelete(scenario);
            }}
            onLaunch={(scenario) => setLaunching([scenario])}
            selected={selected}
            onToggleSelected={toggleSelected}
            duplicatingId={duplicate.isPending ? duplicate.variables?.id : undefined}
          />
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        titleRef={titleRef}
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
      <p role="status" className="sr-only">
        {notice}
      </p>
      {duplicate.isError ? <Alert>{t("scenarios.duplicateFailed", { error: errorMessage(duplicate.error) })}</Alert> : null}
      {body}

      <DeleteScenarioDialog
        scenario={deleting}
        onCancel={() => showDelete(undefined)}
        onConfirm={confirmDelete}
        pending={deleteInFlight}
        error={remove.isError ? errorMessage(remove.error) : undefined}
      />
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

/** Selected scenarios the filters hide: kept, but never launched while hidden. */
function hiddenSelectionText(t: Translator, count: number, othersVisible: boolean): string {
  return othersVisible ? t.plural("scenarios.hiddenMore", count) : t.plural("scenarios.hiddenOnly", count);
}
