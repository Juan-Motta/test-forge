import Link from "next/link";
import { useFormat, useT } from "@/lib/i18n";
import { useState } from "react";
import type { AgentKind } from "@/features/agents/types";
import { Badge, Button, ChevronDownIcon, CopyIcon, IconButton, PlayIcon, Spinner, TrashIcon, cn, focusRing } from "@/ui";
import { temperamentLabel } from "./form-schema";
import type { Scenario } from "./types";

export type ScenarioGroup = { agentId: string; agentName: string; agentKind?: AgentKind; scenarios: Scenario[] };

type ScenarioListProps = {
  groups: ScenarioGroup[];
  onDuplicate: (scenario: Scenario) => void;
  onDelete: (scenario: Scenario) => void;
  onLaunch: (scenario: Scenario) => void;
  /** Launches every scenario the group shows (what the filters leave). */
  onLaunchAll: (group: ScenarioGroup) => void;
  /** Ids picked for "Launch selected". */
  selected: ReadonlySet<string>;
  onToggleSelected: (scenario: Scenario) => void;
  /** Id of the scenario being duplicated, if any. */
  duplicatingId?: string;
};

/**
 * Scenarios grouped by their agent: one panel per agent, headed by its name, kind and count,
 * that collapses; inside, one compact row per scenario.
 */
export function ScenarioList({
  groups,
  onDuplicate,
  onDelete,
  onLaunch,
  onLaunchAll,
  selected,
  onToggleSelected,
  duplicatingId,
}: ScenarioListProps) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (agentId: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const headingId = `agent-group-${group.agentId}`;
        const listId = `agent-scenarios-${group.agentId}`;
        const open = !collapsed.has(group.agentId);
        return (
          <section
            key={group.agentId}
            aria-labelledby={headingId}
            className="overflow-hidden rounded-xl border border-line bg-panel"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                aria-label={t(open ? "scenarios.hideGroup" : "scenarios.showGroup", { name: group.agentName })}
                onClick={() => toggle(group.agentId)}
                className={cn("inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-active", focusRing)}
              >
                <ChevronDownIcon size={16} className={cn("transition-transform", open ? "" : "-rotate-90")} />
              </button>
              <h2 id={headingId} className="min-w-0 text-[15px] font-semibold break-words">
                {group.agentName}
              </h2>
              {group.agentKind ? (
                <Badge tone={group.agentKind === "text" ? "agent" : "outline"}>{t(`agents.kind.${group.agentKind}`)}</Badge>
              ) : null}
              <span className="text-xs text-muted">{t.plural("agents.scenarioCount", group.scenarios.length)}</span>
              <span className="flex-1" />
              <Button
                variant="secondary"
                icon={<PlayIcon size={14} />}
                aria-label={t("scenarios.launchAllNamed", { name: group.agentName })}
                onClick={() => onLaunchAll(group)}
              >
                {t("scenarios.launchAll")}
              </Button>
            </div>
            {open ? (
              <ul id={listId} className="flex flex-col">
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
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** Tags shown on a row before the rest collapse into "+N". */
const VISIBLE_TAGS = 3;

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
  const evaluator =
    scenario.evaluatorMode === "realtime"
      ? scenario.realtimeModel === "gpt-realtime-2.1"
        ? "Realtime 2.1"
        : "Realtime mini"
      : t("scenarios.pipeline");
  const shownTags = scenario.tags.slice(0, VISIBLE_TAGS);
  const moreTags = scenario.tags.length - shownTags.length;
  return (
    <li
      aria-labelledby={nameId}
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-line px-4 py-3 transition-colors",
        "lg:grid-cols-[auto_minmax(0,1fr)_7rem_7.5rem_6rem_8rem_auto]",
        selected ? "bg-evaluator/8" : "hover:bg-active/40",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelected(scenario)}
        aria-label={t("scenarios.select", { name: scenario.name })}
        className="size-4 shrink-0 accent-evaluator"
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 id={nameId} className="text-sm font-semibold break-words">
          {/* The title opens the scenario, so the row needs no separate "Open" button. */}
          <Link
            href={`/scenarios/${encodeURIComponent(scenario.id)}`}
            className={cn("rounded text-evaluator-fg no-underline hover:underline", focusRing)}
          >
            {scenario.name}
          </Link>
        </h3>
        {scenario.tags.length > 0 || interruptions > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {scenario.tags.length > 0 ? (
              <ul aria-label={t("scenarios.field.tags")} className="flex flex-wrap gap-1.5">
                {shownTags.map((tag) => (
                  <li key={tag}>
                    <Badge tone="outline" mono>
                      {tag}
                    </Badge>
                  </li>
                ))}
                {moreTags > 0 ? (
                  <li title={scenario.tags.slice(VISIBLE_TAGS).join(", ")}>
                    <Badge tone="outline">+{moreTags}</Badge>
                  </li>
                ) : null}
              </ul>
            ) : null}
            {interruptions > 0 ? <Badge tone="agent">{t.plural("scenarios.interruptsCount", interruptions)}</Badge> : null}
          </div>
        ) : null}
      </div>
      {/* One line under the name on small screens; from lg its cells become the row's columns. */}
      <div className="col-start-2 row-start-2 flex flex-wrap items-center gap-2 text-xs text-muted lg:contents">
        <span>
          <Badge tone="evaluator">{temperamentLabel(t, scenario.persona.temperament)}</Badge>
        </span>
        <span>{evaluator}</span>
        <span>{t.plural("scenarios.criteriaCount", criteria)}</span>
        <time dateTime={scenario.updatedAt} title={absoluteTime(scenario.updatedAt)}>
          {t("scenarios.updated", { time: relativeTime(scenario.updatedAt) })}
        </time>
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
