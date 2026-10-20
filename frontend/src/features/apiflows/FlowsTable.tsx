import Link from "next/link";
import { useFormat, useT } from "@/lib/i18n";
import { Badge, buttonClasses, cn, focusRing, PlayIcon } from "@/ui";
import { apiHref, flowHref, runHref } from "./ApiTable";
import { MethodChip } from "./MethodChip";
import type { Flow } from "./types";

const HEAD = "border-b border-line px-2 py-2 align-bottom font-medium";
const CELL = "border-b border-line-soft px-2 py-3 align-top";

/**
 * One row per flow: its name (opens it in its API) and description, its API, the method of each
 * step, its agents, how its last run went (opens that run), and a Run action.
 */
export function FlowsTable({ flows }: { flows: Flow[] }) {
  const t = useT();
  const format = useFormat();
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel px-3 py-2">
      <table aria-label={t("flowsPage.tableLabel")} className="w-full min-w-[56rem] table-fixed border-collapse text-left text-[13px]">
        <thead className="text-dim">
          <tr>
            <th scope="col" className={HEAD}>
              {t("flowsPage.column.flow")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[14%]")}>
              {t("flowsPage.column.api")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[16%]")}>
              {t("flowsPage.column.steps")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[16%]")}>
              {t("groups.column.agents")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[11rem]")}>
              {t("flowsPage.column.lastRun")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[6.5rem] text-right")}>
              <span className="sr-only">{t("common.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {flows.map((flow) => {
            const api = { id: flow.apiId };
            const lastRun = flow.lastRun;
            return (
              <tr key={flow.id} className="[&:last-child>td]:border-b-0">
                <td className={CELL}>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Link
                      href={flowHref(api, flow.id)}
                      className={cn("w-fit rounded font-semibold break-words text-evaluator-fg no-underline hover:underline", focusRing)}
                    >
                      {flow.name}
                    </Link>
                    {flow.description ? <p className="line-clamp-2 text-xs text-muted">{flow.description}</p> : null}
                  </div>
                </td>
                <td className={CELL}>
                  <Link href={apiHref(api)} className={cn("rounded break-words text-fg hover:underline", focusRing)}>
                    {flow.api.name}
                  </Link>
                </td>
                <td className={CELL}>
                  <ul aria-label={t("flowsPage.column.steps")} className="flex flex-wrap gap-1">
                    {flow.steps.map((step, index) => (
                      <li key={index}>
                        <MethodChip method={step.method} />
                      </li>
                    ))}
                  </ul>
                </td>
                <td className={CELL}>
                  {flow.agents.length > 0 ? (
                    <ul aria-label={t("groups.column.agents")} className="flex flex-wrap gap-1.5">
                      {flow.agents.map((agent) => (
                        <li key={agent.id}>
                          <Badge tone="muted">{agent.name}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-dim">—</span>
                  )}
                </td>
                <td className={CELL}>
                  {lastRun ? (
                    <Link
                      href={runHref(api, flow.id, lastRun.id)}
                      aria-label={t("flowsPage.lastRunOf", {
                        name: flow.name,
                        status: t(`flowRuns.status.${lastRun.status}`),
                        time: format.relativeTime(lastRun.createdAt),
                      })}
                      className={cn("inline-flex flex-wrap items-center gap-2 rounded text-xs hover:underline", focusRing)}
                    >
                      <Badge tone={lastRun.status === "passed" ? "success" : "danger"}>
                        {t(`flowRuns.status.${lastRun.status}`)}
                      </Badge>
                      <time dateTime={lastRun.createdAt} title={format.absoluteTime(lastRun.createdAt)} className="text-muted">
                        {format.relativeTime(lastRun.createdAt)}
                      </time>
                    </Link>
                  ) : (
                    <span className="text-xs text-dim">{t("flowsPage.neverRun")}</span>
                  )}
                </td>
                <td className={cn(CELL, "text-right")}>
                  <Link
                    href={runHref(api, flow.id, "new")}
                    aria-label={t("flowsPage.runNamed", { name: flow.name })}
                    className={buttonClasses("secondary", "min-h-9 px-3 text-xs")}
                  >
                    <PlayIcon size={14} />
                    {t("flowsPage.run")}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
