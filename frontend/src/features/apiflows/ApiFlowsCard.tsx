"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useFormat, useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, PlayIcon, PlusIcon, buttonClasses, cn, focusRing } from "@/ui";
import { flowHref, newFlowHref } from "./links";
import { MethodChip } from "./MethodChip";
import { useApiFlows } from "./queries";
import { RunAllDialog } from "./RunAllDialog";
import type { Api, Flow } from "./types";

/**
 * The open API's flows on `/apis`: each with the methods of its steps and how its last run went,
 * opening it in the flow workspace; New flow, and Run all once there is a flow to run.
 */
export function ApiFlowsCard({ api }: { api: Pick<Api, "id" | "name"> }) {
  const t = useT();
  const headingId = useId();
  const flows = useApiFlows(api.id);
  const [runningAll, setRunningAll] = useState(false);
  const list = flows.data ?? [];

  let body;
  if (flows.isError && flows.data === undefined) body = <p className="text-sm text-muted">{t("apis.flowsFailed")}</p>;
  else if (flows.isPending) body = <p className="text-sm text-muted">{t("apis.flowsLoading")}</p>;
  else if (list.length === 0) body = <p className="text-sm text-muted">{t("apis.flowsEmpty")}</p>;
  else
    body = (
      <ul aria-label={t("apis.flowsOf", { name: api.name })} className="flex flex-col gap-0.5">
        {list.map((flow) => (
          <li key={flow.id}>
            <FlowRow api={api} flow={flow} />
          </li>
        ))}
      </ul>
    );

  return (
    <Card aria-labelledby={headingId} className="gap-3">
      <div className="flex flex-col gap-1">
        <CardHeader
          id={headingId}
          title={t("apis.flowsTitle")}
          actions={
            <div className="flex flex-wrap gap-2">
              {list.length > 0 ? (
                <Button
                  variant="secondary"
                  icon={<PlayIcon size={14} />}
                  aria-label={t("runAll.buttonNamed", { name: api.name })}
                  onClick={() => setRunningAll(true)}
                >
                  {t("runAll.button")}
                </Button>
              ) : null}
              <Link href={newFlowHref(api)} className={buttonClasses(list.length > 0 ? "secondary" : "primary")}>
                <PlusIcon size={16} />
                {t("apis.newFlow")}
              </Link>
            </div>
          }
        />
        <p className="text-xs text-dim">{t("apis.flowsHint")}</p>
      </div>
      {body}
      {runningAll ? <RunAllDialog api={api} onClose={() => setRunningAll(false)} /> : null}
    </Card>
  );
}

function FlowRow({ api, flow }: { api: Pick<Api, "id">; flow: Flow }) {
  const t = useT();
  const format = useFormat();
  const lastRun = flow.lastRun;
  return (
    <Link
      href={flowHref(api, flow.id)}
      className={cn(
        "flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-lg px-3 py-2.5 text-fg hover:bg-active",
        focusRing,
      )}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] font-medium break-words">{flow.name}</span>
        <span className="flex flex-wrap gap-1">
          {flow.steps.map((step, index) => (
            <MethodChip key={index} method={step.method} />
          ))}
        </span>
      </span>
      {lastRun ? (
        <span className="inline-flex items-center gap-2 text-xs">
          <Badge tone={lastRun.status === "passed" ? "success" : "danger"}>{t(`flowRuns.status.${lastRun.status}`)}</Badge>
          <time dateTime={lastRun.createdAt} title={format.absoluteTime(lastRun.createdAt)} className="text-muted">
            {format.relativeTime(lastRun.createdAt)}
          </time>
        </span>
      ) : (
        <span className="text-xs text-dim">{t("flowsPage.neverRun")}</span>
      )}
    </Link>
  );
}
