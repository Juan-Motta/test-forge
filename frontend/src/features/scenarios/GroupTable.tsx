import Link from "next/link";
import { useFormat, useT } from "@/lib/i18n";
import { Badge, IconButton, PlayIcon, PlusIcon, cn, focusRing } from "@/ui";
import type { ScenarioGroup } from "./types";

const HEAD = "border-b border-line px-2 py-2 align-bottom font-medium";
const CELL = "border-b border-line-soft px-2 py-3 align-top";

export const groupHref = (group: Pick<ScenarioGroup, "id">) => `/scenarios/groups/${encodeURIComponent(group.id)}`;

type GroupTableProps = {
  groups: ScenarioGroup[];
  /** Absent while the scenarios are unknown (loading or failed): no launch is offered. */
  onLaunch?: (group: ScenarioGroup) => void;
};

/**
 * One row per group: its title (opens it) and description, tags, how many scenarios it holds and
 * of which agents, its latest change, and quick actions.
 */
export function GroupTable({ groups, onLaunch }: GroupTableProps) {
  const t = useT();
  const { absoluteTime, relativeTime } = useFormat();
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel px-3 py-2">
      <table aria-label={t("groups.tableLabel")} className="w-full min-w-[52rem] table-fixed border-collapse text-left text-[13px]">
        <thead className="text-dim">
          <tr>
            <th scope="col" className={HEAD}>
              {t("groups.column.group")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[7rem]")}>
              {t("scenarios.column.scenarios")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[24%]")}>
              {t("groups.column.agents")}
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
          {groups.map((group) => {
            const latest = group.latestScenarioAt ?? group.updatedAt;
            return (
              <tr key={group.id} className="[&:last-child>td]:border-b-0">
                <td className={CELL}>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Link
                      href={groupHref(group)}
                      className={cn("w-fit rounded font-semibold break-words text-evaluator-fg no-underline hover:underline", focusRing)}
                    >
                      {group.name}
                    </Link>
                    {group.description ? <p className="line-clamp-2 text-xs text-muted">{group.description}</p> : null}
                    {group.tags.length > 0 ? (
                      <ul aria-label={t("scenarios.field.tags")} className="flex flex-wrap gap-1.5">
                        {group.tags.map((tag) => (
                          <li key={tag}>
                            <Badge tone="outline" mono>
                              {tag}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </td>
                <td className={cn(CELL, "font-mono text-xs")}>{t.plural("agents.scenarioCount", group.scenarioCount)}</td>
                <td className={CELL}>
                  {group.agents.length > 0 ? (
                    <ul aria-label={t("groups.column.agents")} className="flex flex-wrap gap-1.5">
                      {group.agents.map((agent) => (
                        <li key={agent.id}>
                          <Badge tone="muted">{agent.name}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-dim">—</span>
                  )}
                </td>
                <td className={cn(CELL, "text-xs text-muted")}>
                  <time dateTime={latest} title={absoluteTime(latest)}>
                    {relativeTime(latest)}
                  </time>
                </td>
                <td className={CELL}>
                  <div className="flex items-center justify-end gap-1">
                    {onLaunch && group.scenarioCount > 0 ? (
                      <IconButton
                        size="sm"
                        label={t("groups.launch", { name: group.name })}
                        icon={<PlayIcon size={16} />}
                        onClick={() => onLaunch(group)}
                        className="hover:text-evaluator-fg"
                      />
                    ) : null}
                    {/* Styled as the IconButton beside it: a link, since it opens a page. */}
                    <Link
                      href={`/scenarios/new?group=${encodeURIComponent(group.id)}`}
                      aria-label={t("groups.newScenario", { name: group.name })}
                      title={t("groups.newScenario", { name: group.name })}
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
