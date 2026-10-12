import { useId } from "react";
import { Badge, Button } from "@/ui";
import { absoluteTime, relativeTime } from "./format";
import { KINDS, kindLabel } from "./kinds";
import { TestStatus } from "./TestStatus";
import type { Connection } from "./types";

type ConnectionsListProps = {
  connections: Connection[];
  onEdit: (connection: Connection) => void;
  onTest: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  /** Ids of the connections whose stored test is running. */
  testingIds: ReadonlySet<string>;
};

/** Where the connection points: its first configured value (base URL, endpoint, region or host). */
export function connectionTarget(connection: Connection): string | undefined {
  const fields = KINDS[connection.kind]?.config ?? [];
  for (const field of fields) {
    const value = connection.config[field.key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

/** The connections as cards: provider, target, key hint, last test and actions. */
export function ConnectionsList({ connections, onEdit, onTest, onDelete, testingIds }: ConnectionsListProps) {
  return (
    <ul aria-label="Provider connections" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {connections.map((connection) => (
        <li key={connection.id} className="flex">
          <ConnectionCard
            connection={connection}
            testing={testingIds.has(connection.id)}
            onEdit={onEdit}
            onTest={onTest}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ul>
  );
}

type ConnectionCardProps = Omit<ConnectionsListProps, "connections" | "testingIds"> & {
  connection: Connection;
  testing: boolean;
};

function ConnectionCard({ connection, testing, onEdit, onTest, onDelete }: ConnectionCardProps) {
  const headingId = useId();
  const target = connectionTarget(connection);
  return (
    <article
      aria-labelledby={headingId}
      className="flex w-full min-w-0 flex-col gap-3.5 rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="text-[15px] font-semibold break-words">
            {connection.name}
          </h2>
          {target ? <span className="font-mono text-xs break-all text-dim">{target}</span> : null}
        </div>
        <Badge>{kindLabel(connection.kind)}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div className="flex flex-col gap-1">
          <dt className="text-dim">Key</dt>
          <dd className="font-mono text-muted">{connection.hasSecret ? connection.secretHint : "None"}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-dim">Updated</dt>
          <dd>
            <time dateTime={connection.updatedAt} title={absoluteTime(connection.updatedAt)} className="text-muted">
              {relativeTime(connection.updatedAt)}
            </time>
          </dd>
        </div>
      </dl>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-dim">Last test</span>
        <TestStatus lastTest={connection.lastTest} />
      </div>
      <div className="mt-auto flex flex-wrap gap-2 border-t border-line-soft pt-3.5">
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
    </article>
  );
}
