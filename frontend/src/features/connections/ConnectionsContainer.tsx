"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { useT } from "@/lib/i18n";
import { Alert, Button, ConnectionsIcon, Dialog, EmptyState, PlusIcon, Spinner } from "@/ui";
import { ConnectionFormContainer } from "./ConnectionFormContainer";
import { ConnectionsList } from "./ConnectionsList";
import { DeleteConnectionDialog } from "./DeleteConnectionDialog";
import { errorMessage } from "./errors";
import { useConnections, useDeleteConnection, useTestStoredConnection } from "./queries";
import type { Connection } from "./types";

type Editing = { type: "create" } | { type: "edit"; connection: Connection };

/** Container for `/settings/connections`: list, create/edit dialog, row tests and deletion. */
export function ConnectionsContainer() {
  const t = useT();
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
  // Mirrors `deletingNow` for rendering: one delete at a time, even across dialogs.
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const shownDelete = useRef<Connection | undefined>(undefined);
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
      setNotice(t(result.ok ? "connections.rowPassed" : "connections.rowFailed", { name: connection.name }));
    } catch (error) {
      setRowTestError(t("connections.rowTestError", { name: connection.name, error: errorMessage(t, error) }));
    } finally {
      setTesting(connection.id, false);
    }
  }

  /** Opens or closes the dialog; the ref lets a settling delete see what the dialog shows now. */
  function showDelete(connection: Connection | undefined) {
    shownDelete.current = connection;
    setDeleting(connection);
  }

  async function confirmDelete(connection: Connection) {
    if (deletingNow.current) return;
    deletingNow.current = true;
    setDeleteInFlight(true);
    try {
      await remove.mutateAsync(connection);
      setNotice(t("common.deleted", { name: connection.name }));
      // The user may have cancelled and opened another connection's dialog meanwhile: leave that one open.
      if (shownDelete.current?.id === connection.id) {
        focusTitle.current = true;
        showDelete(undefined);
      }
    } catch {
      // Shown through the mutation's error state while its dialog is open.
    } finally {
      // mutateAsync, not mutate's onSettled: `remove.reset()` drops pending mutate callbacks.
      deletingNow.current = false;
      setDeleteInFlight(false);
    }
  }

  function onSaved(connection: Connection) {
    setNotice(t(editing?.type === "create" ? "common.created" : "common.savedNamed", { name: connection.name }));
    setEditing(null);
  }

  const list = connections.data ?? [];
  let body;
  if (connections.isPending) {
    body = <Spinner label={t("connections.loading")} />;
  } else if (connections.isError) {
    body = (
      <Alert title={t("connections.loadFailed")}>
        <span className="block">{errorMessage(t, connections.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => connections.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon={<ConnectionsIcon size={22} />}
        title={t("connections.emptyTitle")}
        description={t("connections.emptyDescription")}
        action={
          <Button icon={<PlusIcon size={16} />} onClick={openCreate}>
            {t("connections.addFirst")}
          </Button>
        }
      />
    );
  } else {
    body = (
      <ConnectionsList
        connections={list}
        onEdit={(connection) => setEditing({ type: "edit", connection })}
        onTest={(connection) => void testRow(connection)}
        onDelete={(connection) => {
          remove.reset();
          showDelete(connection);
        }}
        testingIds={testingIds}
      />
    );
  }

  return (
    <>
      <PageHeader
        titleRef={titleRef}
        eyebrow={t("nav.settings")}
        title={t("nav.connections")}
        description={t("connections.description")}
        actions={
          <Button icon={<PlusIcon size={16} />} onClick={openCreate}>
            {t("connections.add")}
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
        title={editing?.type === "edit" ? t("connections.editNamed", { name: editing.connection.name }) : t("connections.add")}
        description={t("connections.dialogDescription")}
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
        onCancel={() => showDelete(undefined)}
        onConfirm={confirmDelete}
        pending={deleteInFlight}
        error={remove.isError ? errorMessage(t, remove.error) : undefined}
      />
    </>
  );
}
