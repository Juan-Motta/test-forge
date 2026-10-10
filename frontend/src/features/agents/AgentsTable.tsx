import type { ReactNode } from "react";
import { absoluteTime, relativeTime } from "@/features/connections/format";
import { Badge, Button } from "@/ui";
import { urlHost } from "./format";
import { PROTOCOL_LABELS } from "./form-schema";
import type { Agent } from "./types";

type AgentsTableProps = {
  agents: Agent[];
  onEdit: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
  /** Scenarios per agent id; the column is left out while unknown (e.g. the list failed). */
  scenarioCounts?: ReadonlyMap<string, number>;
};

/** Repeats the column header inside each cell where rows become cards (phones). */
function CellLabel({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="mb-1 block text-xs font-medium text-dim md:hidden">
      {children}
    </span>
  );
}

const HEAD = "px-4 py-3 text-left text-xs font-medium text-dim";
const CELL = "align-top md:px-4 md:py-3.5";

/**
 * A table on wide screens; on phones every row restyles into a card. Changing `display` makes
 * some browsers (Safari) drop the implicit table roles, so every element states its role.
 */
export function AgentsTable({ agents, onEdit, onDelete, scenarioCounts }: AgentsTableProps) {
  return (
    <div className="md:overflow-x-auto md:rounded-xl md:border md:border-line md:bg-panel">
      <table role="table" className="w-full text-sm max-md:block">
        <caption className="sr-only">Agents under test</caption>
        <thead role="rowgroup" className="border-b border-line max-md:sr-only">
          <tr role="row">
            <th scope="col" role="columnheader" className={HEAD}>Name</th>
            <th scope="col" role="columnheader" className={HEAD}>Protocol</th>
            <th scope="col" role="columnheader" className={HEAD}>Target</th>
            <th scope="col" role="columnheader" className={HEAD}>Langfuse</th>
            {scenarioCounts ? <th scope="col" role="columnheader" className={HEAD}>Scenarios</th> : null}
            <th scope="col" role="columnheader" className={HEAD}>Updated</th>
            <th scope="col" role="columnheader" className={HEAD}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-md:flex max-md:flex-col max-md:gap-3">
          {agents.map((agent) => (
            <tr
              key={agent.id}
              role="row"
              className="border-line md:border-t md:first:border-t-0 max-md:grid max-md:grid-cols-2 max-md:gap-4 max-md:rounded-xl max-md:border max-md:bg-panel max-md:p-4"
            >
              <th scope="row" role="rowheader" className={`${CELL} text-left break-words max-md:col-span-2`}>
                <span className="block font-semibold">{agent.name}</span>
                {agent.context ? (
                  <span className="mt-1 line-clamp-2 block max-w-md text-xs font-normal text-muted">{agent.context}</span>
                ) : null}
              </th>
              <td role="cell" className={CELL}>
                <CellLabel>Protocol</CellLabel>
                <Badge tone={agent.protocol === "auto" ? "neutral" : "agent"}>{PROTOCOL_LABELS[agent.protocol]}</Badge>
              </td>
              <td role="cell" className={`${CELL} max-md:col-span-2`}>
                <CellLabel>Target</CellLabel>
                <span className="flex flex-col gap-0.5 font-mono text-xs break-all">
                  <span>{urlHost(agent.baseUrl)}</span>
                  <span className="text-muted">{agent.channelId}</span>
                </span>
              </td>
              <td role="cell" className={CELL}>
                <CellLabel>Langfuse</CellLabel>
                {agent.langfuseConnectionId ? (
                  <Badge tone="success">Linked</Badge>
                ) : (
                  <span className="text-xs text-muted">Not linked</span>
                )}
              </td>
              {scenarioCounts ? (
                <td role="cell" className={CELL}>
                  <CellLabel>Scenarios</CellLabel>
                  <span className="text-xs text-muted">{scenarioLabel(scenarioCounts.get(agent.id) ?? 0)}</span>
                </td>
              ) : null}
              <td role="cell" className={CELL}>
                <CellLabel>Updated</CellLabel>
                <time dateTime={agent.updatedAt} title={absoluteTime(agent.updatedAt)} className="text-xs text-muted">
                  {relativeTime(agent.updatedAt)}
                </time>
              </td>
              <td role="cell" className={`${CELL} max-md:col-span-2`}>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Button variant="secondary" aria-label={`Edit ${agent.name}`} onClick={() => onEdit(agent)}>
                    Edit
                  </Button>
                  <Button variant="ghost" aria-label={`Delete ${agent.name}`} onClick={() => onDelete(agent)}>
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function scenarioLabel(count: number): string {
  return count === 1 ? "1 scenario" : `${count} scenarios`;
}
