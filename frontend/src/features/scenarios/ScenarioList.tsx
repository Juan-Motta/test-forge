import Link from "next/link";
import { absoluteTime, relativeTime } from "@/features/connections/format";
import { Badge, Button, buttonClasses } from "@/ui";
import { TEMPERAMENT_LABELS } from "./form-schema";
import type { Scenario } from "./types";

export type ScenarioGroup = { agentId: string; agentName: string; scenarios: Scenario[] };

type ScenarioListProps = {
  groups: ScenarioGroup[];
  onDuplicate: (scenario: Scenario) => void;
  onDelete: (scenario: Scenario) => void;
  onLaunch: (scenario: Scenario) => void;
  /** Ids picked for "Launch selected". */
  selected: ReadonlySet<string>;
  onToggleSelected: (scenario: Scenario) => void;
  /** Id of the scenario being duplicated, if any. */
  duplicatingId?: string;
};

/** Scenarios grouped by their agent, one card per scenario. */
export function ScenarioList({
  groups,
  onDuplicate,
  onDelete,
  onLaunch,
  selected,
  onToggleSelected,
  duplicatingId,
}: ScenarioListProps) {
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => {
        const headingId = `agent-group-${group.agentId}`;
        return (
          <section key={group.agentId} aria-labelledby={headingId} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 id={headingId} className="text-base font-semibold">
                {group.agentName}
              </h2>
              <Badge>{group.scenarios.length}</Badge>
            </div>
            <ul className="flex flex-col gap-2.5">
              {group.scenarios.map((scenario) => (
                <ScenarioItem
                  key={scenario.id}
                  scenario={scenario}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                  onLaunch={onLaunch}
                  selected={selected.has(scenario.id)}
                  onToggleSelected={onToggleSelected}
                  duplicating={duplicatingId === scenario.id}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ScenarioItem({
  scenario,
  onDuplicate,
  onDelete,
  onLaunch,
  selected,
  onToggleSelected,
  duplicating,
}: {
  scenario: Scenario;
  onDuplicate: (scenario: Scenario) => void;
  onDelete: (scenario: Scenario) => void;
  onLaunch: (scenario: Scenario) => void;
  selected: boolean;
  onToggleSelected: (scenario: Scenario) => void;
  duplicating: boolean;
}) {
  const nameId = `scenario-${scenario.id}`;
  const criteria = scenario.criteria.length;
  const interruptions = scenario.interruptions?.length ?? 0;
  return (
    <li
      aria-labelledby={nameId}
      className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-line bg-panel p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(scenario)}
          aria-label={`Select ${scenario.name}`}
          className="mt-1 size-4 shrink-0 accent-evaluator"
        />
        <div className="flex min-w-0 flex-col gap-2">
          <h3 id={nameId} className="font-semibold break-words">
            {scenario.name}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="evaluator">{TEMPERAMENT_LABELS[scenario.persona.temperament]}</Badge>
            <span>{criteria === 1 ? "1 criterion" : `${criteria} criteria`}</span>
            {interruptions > 0 ? (
              <Badge tone="agent">{interruptions === 1 ? "Interrupts 1 reply" : `Interrupts ${interruptions} replies`}</Badge>
            ) : null}
            <span aria-hidden="true">·</span>
            <time dateTime={scenario.updatedAt} title={absoluteTime(scenario.updatedAt)}>
              Updated {relativeTime(scenario.updatedAt)}
            </time>
          </div>
          {scenario.tags.length > 0 ? (
            <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
              {scenario.tags.map((tag) => (
                <li key={tag}>
                  <Badge mono>{tag}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" aria-label={`Launch ${scenario.name}`} onClick={() => onLaunch(scenario)}>
          Launch
        </Button>
        <Link
          href={`/scenarios/${encodeURIComponent(scenario.id)}`}
          aria-label={`Open ${scenario.name}`}
          className={buttonClasses("secondary")}
        >
          Open
        </Link>
        <Button
          variant="secondary"
          loading={duplicating}
          aria-label={`Duplicate ${scenario.name}`}
          onClick={() => onDuplicate(scenario)}
        >
          {duplicating ? "Duplicating…" : "Duplicate"}
        </Button>
        <Button variant="ghost" aria-label={`Delete ${scenario.name}`} onClick={() => onDelete(scenario)}>
          Delete
        </Button>
      </div>
    </li>
  );
}
