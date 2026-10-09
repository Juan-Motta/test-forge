"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { Alert, Button, ConnectionsIcon, Dialog, EmptyState, PlusIcon, Spinner } from "@/ui";
import { ConnectionFormContainer } from "./ConnectionFormContainer";
import { ConnectionsTable } from "./ConnectionsTable";
import { DeleteConnectionDialog } from "./DeleteConnectionDialog";
import { errorMessage } from "./errors";
import { useConnections, useDeleteConnection, useTestStoredConnection } from "./queries";
import type { Connection } from "./types";

type Editing = { type: "create" } | { type: "edit"; connection: Connection };

/** Container for `/settings/connections`: list, create/edit dialog, row tests and deletion. */
export function ConnectionsContainer() {
  const connections = useConnections();
  const rowTest = useTestStoredConnection();
  const remove = useDeleteConnection();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Connection | undefined>(undefined);
  // Persistent polite live region: announces outcomes that otherwise only change the list.
  const [notice, setNotice] = useState("");
  // One mutation serves every row, but its state only tracks the latest call: keep our own.
  const [testingIds, setTestingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [rowTestError, setRowTestError] = useState<string | undefined>(undefined);
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const deletingNow = useRef(false);
  // The deleted row's button had focus; once the dialog is gone, hand focus to the page title.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);

  useEffect(() => {
    if (!focusTitle.current || deleting) return;
    focusTitle.current = false;
    titleRef.current?.focus();
  });

  const openCreate = () => setEditing({ type: "create" });

  function setTesting(id: string, testing: boolean) {
    setTestingIds((ids) => {
      const next = new Set(ids);
      if (testing) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function testRow(connection: Connection) {
    if (testingIds.has(connection.id)) return;
    setNotice("");
    setRowTestError(undefined);
    setTesting(connection.id, true);
    try {
      const result = await rowTest.mutateAsync(connection);
      setNotice(`${connection.name}: test ${result.ok ? "passed" : "failed"}.`);
    } catch (error) {
      setRowTestError(`Could not test ${connection.name}: ${errorMessage(error)}`);
    } finally {
      setTesting(connection.id, false);
    }
  }

  function confirmDelete(connection: Connection) {
    if (deletingNow.current) return;
    deletingNow.current = true;
    remove.mutate(connection, {
      onSuccess: () => {
        focusTitle.current = true;
        setDeleting(undefined);
        setNotice(`Deleted ${connection.name}.`);
      },
      onSettled: () => (deletingNow.current = false),
    });
  }

  function onSaved(connection: Connection) {
    setNotice(editing?.type === "create" ? `Created ${connection.name}.` : `Saved ${connection.name}.`);
    setEditing(null);
  }

  const list = connections.data ?? [];
  let body;
  if (connections.isPending) {
    body = <Spinner label="Loading connections" />;
  } else if (connections.isError) {
    body = (
      <Alert title="Could not load connections">
        <span className="block">{errorMessage(connections.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => connections.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon={<ConnectionsIcon size={22} />}
        title="No connections yet"
        description="Add the credentials runs use to reach OpenAI, Azure OpenAI, Azure AI Speech or Langfuse. Secrets are stored encrypted and only a hint is ever shown."
        action={
          <Button icon={<PlusIcon size={16} />} onClick={openCreate}>
            Add your first connection
          </Button>
        }
      />
    );
  } else {
    body = (
      <ConnectionsTable
        connections={list}
        onEdit={(connection) => setEditing({ type: "edit", connection })}
        onTest={(connection) => void testRow(connection)}
        onDelete={(connection) => {
          remove.reset();
          setDeleting(connection);
        }}
        testingIds={testingIds}
      />
    );
  }

  return (
    <>
      <PageHeader
        titleRef={titleRef}
        title="Connections"
        description="Credentials for the providers runs use. Secrets are write-only: only a hint is ever shown."
        actions={
          <Button icon={<PlusIcon size={16} />} onClick={openCreate}>
            Add connection
          </Button>
        }
      />
      <p role="status" className="sr-only">
        {notice}
      </p>
      {rowTestError ? <Alert>{rowTestError}</Alert> : null}
      {body}

      <Dialog
        open={editing !== null}
        size="lg"
        title={editing?.type === "edit" ? `Edit ${editing.connection.name}` : "Add connection"}
        description="Secrets are stored encrypted and never shown again."
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <ConnectionFormContainer
            connection={editing.type === "edit" ? editing.connection : undefined}
            onCancel={() => setEditing(null)}
            onSaved={onSaved}
          />
        ) : null}
      </Dialog>

      <DeleteConnectionDialog
        connection={deleting}
        onCancel={() => setDeleting(undefined)}
        onConfirm={confirmDelete}
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : undefined}
      />
    </>
  );
}
