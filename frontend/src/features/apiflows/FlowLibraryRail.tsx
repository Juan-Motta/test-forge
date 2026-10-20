"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { PlusIcon, SearchField, cn, focusRing } from "@/ui";
import { flowHref, newFlowHref } from "./ApiTable";
import { MethodChip } from "./MethodChip";
import type { Api, Flow } from "./types";

type FlowLibraryRailProps = {
  api: Pick<Api, "id">;
  /** The API's flows; undefined while loading. */
  flows: Flow[] | undefined;
  failed: boolean;
  /** The flow open in the editor, marked as the current page. */
  selectedId?: string;
};

/** The API's flows beside the page: a filter, each flow with the methods of its steps, and New flow. */
export function FlowLibraryRail({ api, flows, failed, selectedId }: FlowLibraryRailProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = (flows ?? []).filter((flow) => !needle || flow.name.toLowerCase().includes(needle));

  let body;
  if (failed) body = <p className="px-1 text-xs text-muted">{t("apis.flowsFailed")}</p>;
  else if (flows === undefined) body = <p className="px-1 text-xs text-muted">{t("apis.flowsLoading")}</p>;
  else if (visible.length === 0)
    body = <p className="px-1 text-xs text-muted">{needle ? t("apis.flowsNoMatch") : t("apis.flowsEmpty")}</p>;
  else
    body = (
      <ul className="flex flex-col gap-0.5">
        {visible.map((flow) => (
          <li key={flow.id}>
            <Link
              href={flowHref(api, flow.id)}
              aria-current={flow.id === selectedId ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-col gap-1 rounded-lg px-3 py-2.5 text-fg hover:bg-active",
                flow.id === selectedId && "bg-active",
                focusRing,
              )}
            >
              <span className="text-[13px] font-medium break-words">{flow.name}</span>
              <span className="flex flex-wrap gap-1">
                {flow.steps.map((step, index) => (
                  <MethodChip key={index} method={step.method} />
                ))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <aside aria-label={t("apis.flowLibrary")} className="flex min-w-0 flex-col gap-3.5">
      <SearchField
        label={t("apis.filterFlows")}
        placeholder={t("apis.filterFlows")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="bg-panel"
      />
      {body}
      <Link
        href={newFlowHref(api)}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-[13px] text-muted hover:text-fg",
          focusRing,
        )}
      >
        <PlusIcon size={14} />
        {t("apis.newFlow")}
      </Link>
    </aside>
  );
}
