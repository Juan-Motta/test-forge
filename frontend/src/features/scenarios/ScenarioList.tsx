import Link from "next/link";
import { useFormat, useT } from "@/lib/i18n";
import { Badge, CopyIcon, IconButton, PlayIcon, Spinner, TrashIcon, cn, focusRing } from "@/ui";
import { temperamentLabel } from "./form-schema";
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
          <section key={group.agentId} aria-labelledby={headingId} className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 id={headingId} className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                {group.agentName}
              </h2>
              <span className="text-xs text-dim">{group.scenarios.length}</span>
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
  const t = useT();
  const { absoluteTime, relativeTime } = useFormat();
  const nameId = `scenario-${scenario.id}`;
  const criteria = scenario.criteria.length;
  const interruptions = scenario.interruptions?.length ?? 0;
  return (
    <li
      aria-labelledby={nameId}
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-panel p-4 transition-colors",
        selected ? "border-evaluator/60" : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(scenario)}
          aria-label={t("scenarios.select", { name: scenario.name })}
          className="mt-1 size-4 shrink-0 accent-evaluator"
        />
        <div className="flex min-w-0 flex-col gap-2">
          <h3 id={nameId} className="text-[15px] font-semibold break-words">
            {/* The title opens the scenario, so the card needs no separate "Open" button. */}
            <Link
              href={`/scenarios/${encodeURIComponent(scenario.id)}`}
              className={cn("rounded text-fg no-underline hover:text-evaluator-fg hover:underline", focusRing)}
            >
              {scenario.name}
            </Link>
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="evaluator">{temperamentLabel(t, scenario.persona.temperament)}</Badge>
            <span>{t.plural("scenarios.criteriaCount", criteria)}</span>
            {interruptions > 0 ? (
              <Badge tone="agent">{t.plural("scenarios.interruptsCount", interruptions)}</Badge>
            ) : null}
            {scenario.evaluatorMode === "realtime" ? (
              <Badge tone="evaluator">{scenario.realtimeModel === "gpt-realtime-2.1" ? "Realtime 2.1" : "Realtime mini"}</Badge>
            ) : null}
            <span aria-hidden="true">·</span>
            <time dateTime={scenario.updatedAt} title={absoluteTime(scenario.updatedAt)}>
              {t("scenarios.updated", { time: relativeTime(scenario.updatedAt) })}
            </time>
          </div>
          {scenario.tags.length > 0 ? (
            <ul aria-label={t("scenarios.field.tags")} className="flex flex-wrap gap-1.5">
              {scenario.tags.map((tag) => (
                <li key={tag}>
                  <Badge tone="outline" mono>
                    {tag}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <IconButton
          size="sm"
          label={t("launch.titleOne", { name: scenario.name })}
          icon={<PlayIcon size={16} />}
          onClick={() => onLaunch(scenario)}
          className="hover:text-evaluator-fg"
        />
        <IconButton
          size="sm"
          label={t("scenarios.duplicateNamed", { name: scenario.name })}
          icon={duplicating ? <Spinner size={14} /> : <CopyIcon size={16} />}
          disabled={duplicating}
          aria-busy={duplicating || undefined}
          onClick={() => onDuplicate(scenario)}
        />
        <IconButton
          size="sm"
          label={t("scenarios.deleteNamed", { name: scenario.name })}
          icon={<TrashIcon size={16} />}
          onClick={() => onDelete(scenario)}
          className="hover:text-danger-fg"
        />
      </div>
    </li>
  );
}
