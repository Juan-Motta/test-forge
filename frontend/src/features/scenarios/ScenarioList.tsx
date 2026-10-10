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
  /** Id of the scenario being duplicated, if any. */
  duplicatingId?: string;
};

/** Scenarios grouped by their agent, one card per scenario. */
export function ScenarioList({ groups, onDuplicate, onDelete, duplicatingId }: ScenarioListProps) {
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
  duplicating,
}: {
  scenario: Scenario;
  onDuplicate: (scenario: Scenario) => void;
  onDelete: (scenario: Scenario) => void;
  duplicating: boolean;
}) {
  const nameId = `scenario-${scenario.id}`;
  const criteria = scenario.criteria.length;
  return (
    <li
      aria-labelledby={nameId}
      className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-line bg-panel p-4"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h3 id={nameId} className="font-semibold break-words">
          {scenario.name}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone="evaluator">{TEMPERAMENT_LABELS[scenario.persona.temperament]}</Badge>
          <span>{criteria === 1 ? "1 criterion" : `${criteria} criteria`}</span>
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
      <div className="flex flex-wrap gap-2">
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
