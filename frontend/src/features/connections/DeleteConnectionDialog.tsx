"use client";

import { useT } from "@/lib/i18n";
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
  const t = useT();
  return (
    <Dialog
      open={connection !== undefined}
      title={connection ? t("common.deleteTitle", { name: connection.name }) : ""}
      description={t("connections.deleteDescription")}
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={pending} onClick={() => connection && onConfirm(connection)}>
            {pending ? t("common.deleting") : t("connections.delete")}
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
    </Dialog>
  );
}
