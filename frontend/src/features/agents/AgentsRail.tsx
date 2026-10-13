import { Badge, cn, focusRing } from "@/ui";
import { IDLE_TEST, ReachabilityDot, reachabilityLabel, type ConnectionTestState } from "./ConnectionCheck";
import { KIND_LABELS, PROTOCOL_LABELS, TEXT_MODE_LABELS } from "./form-schema";
import type { Agent } from "./types";

type AgentsRailProps = {
  agents: Agent[];
  selectedId: string;
  onSelect: (agent: Agent) => void;
  /** Scenarios per agent id; left out while unknown (e.g. the scenarios failed to load). */
  scenarioCounts?: ReadonlyMap<string, number>;
  /** Connection tests run in this session, by agent id. */
  tests: Readonly<Record<string, ConnectionTestState>>;
};

function scenarioLabel(count: number): string {
  return count === 1 ? "1 scenario" : `${count} scenarios`;
}

/** The master list: one card per agent, the open one marked current. */
export function AgentsRail({ agents, selectedId, onSelect, scenarioCounts, tests }: AgentsRailProps) {
  return (
    <aside aria-label="Agents" className="flex min-w-0 flex-col gap-2 lg:w-60 lg:shrink-0">
      <ul className="flex flex-col gap-2">
        {agents.map((agent) => {
          const selected = agent.id === selectedId;
          const test = tests[agent.id] ?? IDLE_TEST;
          const meta = [
            scenarioCounts ? scenarioLabel(scenarioCounts.get(agent.id) ?? 0) : null,
            agent.kind === "text" ? TEXT_MODE_LABELS[agent.textMode ?? "stream"].label : PROTOCOL_LABELS[agent.protocol],
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={agent.id}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(agent)}
                className={cn(
                  "flex w-full min-h-11 flex-col gap-1.5 rounded-[10px] border p-3.5 text-left transition-colors",
                  selected ? "border-line-strong bg-active" : "border-transparent hover:bg-active/60",
                  focusRing,
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-sm font-semibold break-words">{agent.name}</span>
                  <ReachabilityDot state={test} />
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-dim">
                  <Badge tone="outline" className="text-[11px]">
                    {KIND_LABELS[agent.kind].label}
                  </Badge>
                  {meta}
                </span>
                <span className="sr-only">{reachabilityLabel(test)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
