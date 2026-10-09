"use client";

import { Alert, Button, Dialog } from "@/ui";
import type { Connection } from "./types";

type DeleteConnectionDialogProps = {
  connection: Connection | undefined;
  onCancel: () => void;
  onConfirm: (connection: Connection) => void;
  pending: boolean;
  error?: string;
};

/** Confirmation naming the connection; nothing is deleted until the user confirms. */
export function DeleteConnectionDialog({ connection, onCancel, onConfirm, pending, error }: DeleteConnectionDialogProps) {
  return (
    <Dialog
      open={connection !== undefined}
      title={connection ? `Delete “${connection.name}”?` : ""}
      description="Runs that use this connection will fail until they use another one. This cannot be undone."
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={() => connection && onConfirm(connection)}>
            {pending ? "Deleting…" : "Delete connection"}
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
    </Dialog>
  );
}
