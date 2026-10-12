"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAgents } from "@/features/agents/queries";
import { LaunchRunsDialog } from "@/features/runs/LaunchRunsDialog";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
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
      setNotice(`Deleted ${scenario.name}.`);
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
      New scenario
    </Button>
  ) : (
    <Link href="/scenarios/new" className={buttonClasses("primary")}>
      <PlusIcon size={16} />
      New scenario
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
    body = <Spinner label="Loading scenarios" />;
  } else if (scenarios.isError || agents.isError) {
    const failed = scenarios.isError ? scenarios : agents;
    body = (
      <Alert title="Could not load scenarios">
        <span className="block">{errorMessage(failed.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => failed.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon={<ScenariosIcon size={22} />}
        title="No scenarios yet"
        description="A scenario describes the caller the evaluator plays, what it knows and wants, and how the judge scores the call."
        action={newScenario}
      />
    );
  } else {
    const tags = allTags(list);
    body = (
      <>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full sm:w-64">
            <Field label="Agent">
              {(props) => (
                <Select
                  {...props}
                  value={filters.agentId}
                  onChange={(event) => setFilters((current) => ({ ...current, agentId: event.target.value }))}
                >
                  <option value="">All agents</option>
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
              label="Filter by tag"
              size="md"
              options={[{ value: "", label: "All tags" }, ...tags.map((tag) => ({ value: tag, label: tag }))]}
              selected={[filters.tag ?? ""]}
              onToggle={(tag) => setFilters((f) => ({ ...f, tag: tag === "" || f.tag === tag ? null : tag }))}
            />
          ) : null}
        </div>
        {picked.length > 0 || hiddenCount > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-evaluator-line bg-panel px-4 py-3">
            {picked.length > 0 ? (
              <p className="text-sm text-muted">{picked.length === 1 ? "1 scenario selected" : `${picked.length} scenarios selected`}</p>
            ) : null}
            {hiddenCount > 0 ? <p className="text-sm text-muted">{hiddenSelectionText(hiddenCount, picked.length > 0)}</p> : null}
            {picked.length > 0 ? (
              <Button onClick={() => setLaunching(picked)}>{`Launch selected (${picked.length})`}</Button>
            ) : null}
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
        ) : null}
        {groups.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-strong bg-panel p-5">
            <p className="text-sm text-muted">No scenarios match these filters.</p>
            <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
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
        title="Scenarios"
        eyebrow="Library"
        description="Conversations the evaluator plays against an agent, and how the judge scores them."
        actions={newScenario}
      />
      {noAgents ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <p id={NO_AGENT_HINT_ID}>Add an agent first: scenarios are written against an agent.</p>
          <Link href="/agents" className={cn("rounded", focusRing)}>
            Add an agent
          </Link>
        </div>
      ) : null}
      <p role="status" className="sr-only">
        {notice}
      </p>
      {duplicate.isError ? <Alert>{`Could not duplicate: ${errorMessage(duplicate.error)}`}</Alert> : null}
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
        scenarios={(launching ?? []).map(({ id, name, endConditions }) => ({
          id,
          name,
          maxDurationS: endConditions.maxDurationS,
        }))}
        onClose={() => setLaunching(undefined)}
        onLaunched={(batch) => router.push(`/live?batchId=${encodeURIComponent(batch.id)}`)}
      />
    </>
  );
}

/** Selected scenarios the filters hide: kept, but never launched while hidden. */
function hiddenSelectionText(count: number, othersVisible: boolean): string {
  if (othersVisible) return `${count} more ${count === 1 ? "is" : "are"} hidden by the filters and will not launch.`;
  return count === 1 ? "1 selected scenario is hidden by the filters." : `${count} selected scenarios are hidden by the filters.`;
}
