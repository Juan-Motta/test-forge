"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAgents } from "@/features/agents/queries";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { Alert, Button, EmptyState, Field, PlusIcon, ScenariosIcon, Select, Spinner, buttonClasses, cn, focusRing } from "@/ui";
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
  // Refs, not mutation state: two clicks can land before React re-renders the disabled button.
  const duplicatingNow = useRef(false);
  const deletingNow = useRef(false);
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

  function confirmDelete(scenario: Scenario) {
    if (deletingNow.current) return;
    deletingNow.current = true;
    remove.mutate(scenario, {
      onSuccess: () => {
        focusTitle.current = true;
        setDeleting(undefined);
        setNotice(`Deleted ${scenario.name}.`);
      },
      onSettled: () => (deletingNow.current = false),
    });
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
    const groups = groupScenarios(list, agentList, filters);
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
            <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-2">
              <TagChip label="All tags" pressed={filters.tag === null} onClick={() => setFilters((f) => ({ ...f, tag: null }))} />
              {tags.map((tag) => (
                <TagChip
                  key={tag}
                  label={tag}
                  pressed={filters.tag === tag}
                  onClick={() => setFilters((f) => ({ ...f, tag: f.tag === tag ? null : tag }))}
                />
              ))}
            </div>
          ) : null}
        </div>
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
              setDeleting(scenario);
            }}
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
        onCancel={() => setDeleting(undefined)}
        onConfirm={confirmDelete}
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : undefined}
      />
    </>
  );
}

function TagChip({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center rounded-full border px-3.5 font-mono text-xs transition-colors",
        focusRing,
        pressed ? "border-evaluator bg-evaluator/15 text-fg" : "border-line-strong text-muted hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}
