import Link from "next/link";
import { useT } from "@/lib/i18n";
import { Badge, IconButton, KeyIcon, PlayIcon, PlusIcon, cn, focusRing } from "@/ui";
import type { Api } from "./types";

const HEAD = "border-b border-line px-2 py-2 align-bottom font-medium";
const CELL = "border-b border-line-soft px-2 py-3 align-top";

export const apiHref = (api: Pick<Api, "id">) => `/apis/${encodeURIComponent(api.id)}`;
/** Where a new flow of the API starts in the flow editor. */
export const newFlowHref = (api: Pick<Api, "id">) => `${apiHref(api)}?new=flow`;
/** One flow of the API, open in the flow editor. */
export const flowHref = (api: Pick<Api, "id">, flowId: string) => `${apiHref(api)}?flow=${encodeURIComponent(flowId)}`;
/** The run form of a flow (`run=new`), or one of its stored runs. */
export const runHref = (api: Pick<Api, "id">, flowId: string, runId: string) =>
  `${flowHref(api, flowId)}&run=${encodeURIComponent(runId)}`;

/**
 * One row per API: its name (opens it), description and tags; its base URL and the names of its
 * secrets; how many flows it holds and of which agents; and quick actions.
 */
export function ApiTable({ apis, onRunAll }: { apis: Api[]; onRunAll: (api: Api) => void }) {
  const t = useT();
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel px-3 py-2">
      <table aria-label={t("apis.tableLabel")} className="w-full min-w-[52rem] table-fixed border-collapse text-left text-[13px]">
        <thead className="text-dim">
          <tr>
            <th scope="col" className={HEAD}>
              {t("apis.column.api")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[28%]")}>
              {t("apis.column.baseUrl")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[6rem]")}>
              {t("apis.column.flows")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[18%]")}>
              {t("groups.column.agents")}
            </th>
            <th scope="col" className={cn(HEAD, "w-[5.5rem] text-right")}>
              <span className="sr-only">{t("common.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {apis.map((api) => (
            <tr key={api.id} className="[&:last-child>td]:border-b-0">
              <td className={CELL}>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Link
                    href={apiHref(api)}
                    className={cn("w-fit rounded font-semibold break-words text-evaluator-fg no-underline hover:underline", focusRing)}
                  >
                    {api.name}
                  </Link>
                  {api.description ? <p className="line-clamp-2 text-xs text-muted">{api.description}</p> : null}
                  {api.tags.length > 0 ? (
                    <ul aria-label={t("scenarios.field.tags")} className="flex flex-wrap gap-1.5">
                      {api.tags.map((tag) => (
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
              <td className={CELL}>
                <div className="flex min-w-0 items-start gap-1.5">
                  <span className="font-mono text-xs break-all">{api.baseUrl}</span>
                  {api.secrets.length > 0 ? (
                    <span
                      role="img"
                      aria-label={t("apis.secretNames", { names: api.secrets.map((secret) => secret.name).join(", ") })}
                      title={api.secrets.map((secret) => secret.name).join(", ")}
                      className="mt-0.5 shrink-0 text-dim"
                    >
                      <KeyIcon size={13} />
                    </span>
                  ) : null}
                </div>
              </td>
              <td className={cn(CELL, "font-mono text-xs")}>{t.plural("apis.flowCount", api.flowCount)}</td>
              <td className={CELL}>
                {api.agents.length > 0 ? (
                  <ul aria-label={t("groups.column.agents")} className="flex flex-wrap gap-1.5">
                    {api.agents.map((agent) => (
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
                <div className="flex items-center justify-end gap-1">
                  {api.flowCount > 0 ? (
                    <IconButton
                      size="sm"
                      label={t("runAll.buttonNamed", { name: api.name })}
                      icon={<PlayIcon size={15} />}
                      className="text-muted hover:text-fg"
                      onClick={() => onRunAll(api)}
                    />
                  ) : null}
                  <Link
                    href={newFlowHref(api)}
                    aria-label={t("apis.newFlowIn", { name: api.name })}
                    title={t("apis.newFlowIn", { name: api.name })}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
