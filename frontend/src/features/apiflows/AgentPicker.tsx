"use client";

import { useId, useState } from "react";
import { useT } from "@/lib/i18n";
import { Badge, Button, ChevronDownIcon, cn, focusRing } from "@/ui";
import type { NamedRef } from "./types";

type AgentPickerProps = {
  /** Every agent to choose from; undefined while loading. */
  agents: NamedRef[] | undefined;
  failed: boolean;
  /** The flow's agents as stored, so their names show before the list arrives. */
  known: NamedRef[];
  selected: string[];
  onChange: (ids: string[]) => void;
};

/** "Used by" with the agents the flow is meant for, and a checklist to choose them. */
export function AgentPicker({ agents, failed, known, selected, onChange }: AgentPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const nameOf = (id: string) => agents?.find((agent) => agent.id === id)?.name ?? known.find((agent) => agent.id === id)?.name ?? id;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);

  let list;
  if (failed) list = <p className="text-xs text-danger-fg">{t("flows.agentsFailed")}</p>;
  else if (agents === undefined) list = <p className="text-xs text-muted">{t("flows.agentsLoading")}</p>;
  else if (agents.length === 0) list = <p className="text-xs text-muted">{t("flows.agentsEmpty")}</p>;
  else
    list = (
      <ul className="flex flex-col gap-0.5">
        {agents.map((agent) => (
          <li key={agent.id}>
            <label className={cn("flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] hover:bg-active", focusRing)}>
              <input type="checkbox" checked={selected.includes(agent.id)} onChange={() => toggle(agent.id)} />
              {agent.name}
            </label>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">{t("flows.usedBy")}</span>
        {selected.length === 0 ? (
          <span className="text-dim">{t("flows.noAgents")}</span>
        ) : (
          <ul aria-label={t("flows.usedBy")} className="flex flex-wrap gap-1.5">
            {selected.map((id) => (
              <li key={id}>
                <Badge tone="agent">{nameOf(id)}</Badge>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls={listId}
          icon={<ChevronDownIcon size={14} className={cn(open && "rotate-180")} />}
          onClick={() => setOpen((value) => !value)}
        >
          {t("flows.chooseAgents")}
        </Button>
      </div>
      {open ? (
        <fieldset id={listId} className="max-w-sm rounded-lg border border-line bg-raised p-2">
          <legend className="sr-only">{t("flows.chooseAgents")}</legend>
          {list}
        </fieldset>
      ) : null}
    </div>
  );
}
