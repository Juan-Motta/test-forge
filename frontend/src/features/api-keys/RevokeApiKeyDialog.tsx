"use client";

import { Alert, Button, Dialog } from "@/ui";
import type { ApiKey } from "./types";

type RevokeApiKeyDialogProps = {
  apiKey: ApiKey | undefined;
  onCancel: () => void;
  onConfirm: (key: ApiKey) => void;
  pending: boolean;
  error?: string;
};

/** Confirmation naming the key; nothing is revoked until the user confirms. */
export function RevokeApiKeyDialog({ apiKey, onCancel, onConfirm, pending, error }: RevokeApiKeyDialogProps) {
  return (
    <Dialog
      open={apiKey !== undefined}
      title={apiKey ? `Revoke “${apiKey.name}”?` : ""}
      description="Scripts and agents using this key will be rejected right away. This cannot be undone."
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={() => apiKey && onConfirm(apiKey)}>
            {pending ? "Revoking…" : "Revoke key"}
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
    </Dialog>
  );
}
