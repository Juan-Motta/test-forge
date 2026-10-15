"use client";

import { useT } from "@/lib/i18n";
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
  const t = useT();
  return (
    <Dialog
      open={apiKey !== undefined}
      title={apiKey ? t("apiKeys.revokeTitle", { name: apiKey.name }) : ""}
      description={t("apiKeys.revokeDescription")}
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={pending} onClick={() => apiKey && onConfirm(apiKey)}>
            {pending ? t("apiKeys.revoking") : t("apiKeys.revokeKey")}
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
    </Dialog>
  );
}
