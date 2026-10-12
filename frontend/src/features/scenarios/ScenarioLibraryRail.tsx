"use client";

import Link from "next/link";
import { useState } from "react";
import { confirmLeave } from "@/lib/navigation/unsaved-changes";
import { PlusIcon, SearchField, cn, focusRing } from "@/ui";
import { TEMPERAMENT_LABELS } from "./form-schema";
import type { Scenario } from "./types";

const UNTAGGED = "Untagged";

type RailGroup = { name: string; scenarios: Scenario[] };

/** Groups by each scenario's first tag (alphabetically, untagged last), keeping the API order inside. */
export function railGroups(scenarios: Scenario[]): RailGroup[] {
  const groups = new Map<string, Scenario[]>();
  for (const scenario of scenarios) {
    const name = scenario.tags[0] ?? UNTAGGED;
    groups.set(name, [...(groups.get(name) ?? []), scenario]);
  }
  return [...groups.entries()]
    .map(([name, items]) => ({ name, scenarios: items }))
    .sort((a, b) => Number(a.name === UNTAGGED) - Number(b.name === UNTAGGED) || a.name.localeCompare(b.name));
}

type ScenarioLibraryRailProps = {
  /** The library to show (already narrowed to the agent); undefined while loading. */
  scenarios: Scenario[] | undefined;
  failed: boolean;
  /** The scenario open in the editor, highlighted. */
  currentId?: string;
};

/** Compact scenario library beside the editor: filter, groups by tag, the open one highlighted. */
export function ScenarioLibraryRail({ scenarios, failed, currentId }: ScenarioLibraryRailProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = (scenarios ?? []).filter((scenario) => !needle || scenario.name.toLowerCase().includes(needle));
  const groups = railGroups(visible);
  const leave = (event: { preventDefault: () => void }) => (confirmLeave() ? undefined : event.preventDefault());

  let body;
  if (failed) body = <p className="px-1 text-xs text-muted">Could not load the scenario library.</p>;
  else if (scenarios === undefined) body = <RailSkeleton />;
  else if (groups.length === 0)
    body = <p className="px-1 text-xs text-muted">{needle ? "No scenarios match." : "No scenarios yet."}</p>;
  else
    body = groups.map((group, index) => {
      const headingId = `rail-group-${index}`;
      return (
        <section key={group.name} aria-labelledby={headingId} className="flex flex-col gap-1">
          <h3
            id={headingId}
            className="flex items-center justify-between px-1 py-1.5 text-xs font-semibold tracking-[0.06em] text-muted uppercase"
          >
            <span>{group.name}</span>{" "}
            <span className="font-normal text-dim">{group.scenarios.length}</span>
          </h3>
          <ul className="flex flex-col gap-0.5">
            {group.scenarios.map((scenario) => {
              const current = scenario.id === currentId;
              return (
                <li key={scenario.id}>
                  <Link
                    href={`/scenarios/${encodeURIComponent(scenario.id)}`}
                    aria-current={current ? "page" : undefined}
                    onNavigate={leave}
                    className={cn(
                      "flex min-h-11 flex-col gap-0.5 rounded-lg px-3 py-2.5 text-fg hover:bg-active",
                      current && "bg-active",
                      focusRing,
                    )}
                  >
                    <span className="text-[13px] font-medium break-words">{scenario.name}</span>
                    <span className="text-xs text-muted">{TEMPERAMENT_LABELS[scenario.persona.temperament]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      );
    });

  return (
    <aside aria-label="Scenario library" className="flex min-w-0 flex-col gap-3.5">
      <SearchField
        label="Filter scenarios"
        placeholder="Filter scenarios"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="bg-panel"
      />
      {body}
      <Link
        href="/scenarios/new"
        onNavigate={leave}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-[13px] text-muted hover:text-fg",
          focusRing,
        )}
      >
        <PlusIcon size={14} />
        New scenario
      </Link>
    </aside>
  );
}

/** Placeholder rows while the library loads; the editor beside it does not wait for them. */
function RailSkeleton() {
  return (
    <div role="status" aria-label="Loading scenarios" className="flex flex-col gap-1.5 px-1">
      <span aria-hidden="true" className="h-3 w-24 animate-pulse rounded bg-chip motion-reduce:animate-none" />
      {[0, 1, 2, 3].map((row) => (
        <span
          key={row}
          aria-hidden="true"
          className="flex h-11 animate-pulse flex-col justify-center gap-1.5 rounded-lg px-3 motion-reduce:animate-none"
        >
          <span className="h-3 w-4/5 rounded bg-chip" />
          <span className="h-2.5 w-1/3 rounded bg-chip" />
        </span>
      ))}
    </div>
  );
}
