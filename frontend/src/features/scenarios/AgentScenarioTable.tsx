import Link from "next/link";
import type { Agent } from "@/features/agents/types";
import { useFormat, useT } from "@/lib/i18n";
import { Badge, IconButton, PlayIcon, PlusIcon, cn, focusRing } from "@/ui";
import type { Scenario } from "./types";

const HEAD = "border-b border-line px-2 py-2 align-bottom font-medium";
const CELL = "border-b border-line-soft px-2 py-3 align-middle";
/** Tags shown per agent before the rest collapse into "+N". */
const VISIBLE_TAGS = 4;

export type AgentScenarios = { agent: Agent; scenarios: Scenario[] };

/** Every agent with its scenarios, in the agents' order; within one, the API order (newest first). */
export function scenariosByAgent(agents: Agent[], scenarios: Scenario[]): AgentScenarios[] {
  return agents.map((agent) => ({ agent, scenarios: scenarios.filter((scenario) => scenario.agentId === agent.id) }));
}

/** The agent's tags, most used first (ties alphabetically). */
function tagsOf(scenarios: Scenario[]): string[] {
  const counts = new Map<string, number>();
  for (const tag of scenarios.flatMap((scenario) => scenario.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

/** Where an agent's name leads: its newest scenario (the editor shows its whole library), or a new one. */
export function agentScenariosHref({ agent, scenarios }: AgentScenarios): string {
  return scenarios[0]
    ? `/scenarios/${encodeURIComponent(scenarios[0].id)}`
    : `/scenarios/new?agent=${encodeURIComponent(agent.id)}`;
}

type AgentScenarioTableProps = {
  rows: AgentScenarios[];
  onLaunchAll: (row: AgentScenarios) => void;
};

/** One row per agent: how many scenarios it has, their tags, the latest change and quick actions. */
export function AgentScenarioTable({ rows, onLaunchAll }: AgentScenarioTableProps) {
  const t = useT();
  const { absoluteTime, relativeTime } = useFormat();
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel px-3 py-2">
      <table aria-label={t("scenarios.byAgent")} className="w-full min-w-[44rem] table-fixed border-collapse text-left text-[13px]">
        <thead className="text-dim">
          <tr>
            <th scope="col" className={HEAD}>
              {t("common.agent")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[7rem]")}>
              {t("scenarios.column.scenarios")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[34%]")}>
              {t("scenarios.field.tags")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[8rem]")}>
              {t("scenarios.column.updated")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[6rem] text-right")}>
              <span className="sr-only">{t("common.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { agent, scenarios } = row;
            const tags = tagsOf(scenarios);
            const shown = tags.slice(0, VISIBLE_TAGS);
            const latest = scenarios.reduce<string | undefined>(
              (max, scenario) => (!max || scenario.updatedAt > max ? scenario.updatedAt : max),
              undefined,
            );
            return (
              <tr key={agent.id} className="[&:last-child>td]:border-b-0">
                <td className={CELL}>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link
                      href={agentScenariosHref(row)}
                      className={cn("rounded font-semibold break-words text-evaluator-fg no-underline hover:underline", focusRing)}
                    >
                      {agent.name}
                    </Link>
                    <Badge tone={agent.kind === "text" ? "agent" : "outline"}>{t(`agents.kind.${agent.kind}`)}</Badge>
                  </div>
                </td>
                <td className={cn(CELL, "font-mono text-xs")}>{t.plural("agents.scenarioCount", scenarios.length)}</td>
                <td className={CELL}>
                  {shown.length > 0 ? (
                    <ul aria-label={t("scenarios.field.tags")} className="flex flex-wrap gap-1.5">
                      {shown.map((tag) => (
                        <li key={tag}>
                          <Badge tone="outline" mono>
                            {tag}
                          </Badge>
                        </li>
                      ))}
                      {tags.length > shown.length ? (
                        <li title={tags.slice(VISIBLE_TAGS).join(", ")}>
                          <Badge tone="outline">+{tags.length - shown.length}</Badge>
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <span className="text-xs text-dim">—</span>
                  )}
                </td>
                <td className={cn(CELL, "text-xs text-muted")}>
                  {latest ? (
                    <time dateTime={latest} title={absoluteTime(latest)}>
                      {relativeTime(latest)}
                    </time>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={CELL}>
                  <div className="flex items-center justify-end gap-1">
                    {scenarios.length > 0 ? (
                      <IconButton
                        size="sm"
                        label={t("scenarios.launchAllNamed", { name: agent.name })}
                        icon={<PlayIcon size={16} />}
                        onClick={() => onLaunchAll(row)}
                        className="hover:text-evaluator-fg"
                      />
                    ) : null}
                    <Link
                      href={`/scenarios/new?agent=${encodeURIComponent(agent.id)}`}
                      aria-label={t("scenarios.newFor", { name: agent.name })}
                      title={t("scenarios.newFor", { name: agent.name })}
                      // Styled as the IconButton beside it: a link, since it opens a page.
                      className={cn(
                        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-active hover:text-fg",
                        focusRing,
                      )}
                    >
                      <PlusIcon size={16} />
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
