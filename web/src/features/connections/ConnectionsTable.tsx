import type { ReactNode } from "react";
import { Badge, Button } from "@/ui";
import { absoluteTime, relativeTime } from "./format";
import { kindLabel } from "./kinds";
import { TestStatus } from "./TestStatus";
import type { Connection } from "./types";

type ConnectionsTableProps = {
  connections: Connection[];
  onEdit: (connection: Connection) => void;
  onTest: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  /** Id of the connection whose stored test is running. */
  testingId?: string;
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

/** A table on wide screens; on phones every row restyles into a card (same DOM, same semantics). */
export function ConnectionsTable({ connections, onEdit, onTest, onDelete, testingId }: ConnectionsTableProps) {
  return (
    <div className="md:overflow-x-auto md:rounded-xl md:border md:border-line md:bg-panel">
      <table className="w-full text-sm max-md:block">
        <caption className="sr-only">Provider connections</caption>
        <thead className="border-b border-line max-md:sr-only">
          <tr>
            <th scope="col" className={HEAD}>Name</th>
            <th scope="col" className={HEAD}>Provider</th>
            <th scope="col" className={HEAD}>Key</th>
            <th scope="col" className={HEAD}>Last test</th>
            <th scope="col" className={HEAD}>Updated</th>
            <th scope="col" className={HEAD}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="max-md:flex max-md:flex-col max-md:gap-3">
          {connections.map((connection) => {
            const testing = testingId === connection.id;
            return (
              <tr
                key={connection.id}
                className="border-line md:border-t md:first:border-t-0 max-md:grid max-md:grid-cols-2 max-md:gap-4 max-md:rounded-xl max-md:border max-md:bg-panel max-md:p-4"
              >
                <th scope="row" className={`${CELL} text-left font-semibold break-words max-md:col-span-2`}>
                  {connection.name}
                </th>
                <td className={CELL}>
                  <CellLabel>Provider</CellLabel>
                  <Badge>{kindLabel(connection.kind)}</Badge>
                </td>
                <td className={CELL}>
                  <CellLabel>Key</CellLabel>
                  <span className="font-mono text-xs text-muted">{connection.hasSecret ? connection.secretHint : "None"}</span>
                </td>
                <td className={`${CELL} max-md:col-span-2`}>
                  <CellLabel>Last test</CellLabel>
                  <TestStatus lastTest={connection.lastTest} />
                </td>
                <td className={CELL}>
                  <CellLabel>Updated</CellLabel>
                  <time
                    dateTime={connection.updatedAt}
                    title={absoluteTime(connection.updatedAt)}
                    className="text-xs text-muted"
                  >
                    {relativeTime(connection.updatedAt)}
                  </time>
                </td>
                <td className={`${CELL} max-md:col-span-2`}>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <Button variant="secondary" aria-label={`Edit ${connection.name}`} onClick={() => onEdit(connection)}>
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      loading={testing}
                      aria-label={`${testing ? "Testing" : "Test"} ${connection.name}`}
                      onClick={() => onTest(connection)}
                    >
                      {testing ? "Testing…" : "Test"}
                    </Button>
                    <Button variant="ghost" aria-label={`Delete ${connection.name}`} onClick={() => onDelete(connection)}>
                      Delete
                    </Button>
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
