"use client";

import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, Button, Dialog } from "@/ui";
import { useDeleteApi } from "./queries";
import type { Api } from "./types";

type DeleteApiDialogProps = {
  /** The API asked about; undefined while closed. */
  api: Api | undefined;
  onClose: () => void;
  /** Called once the API is gone. */
  onDeleted: (api: Api) => void;
};

/** Confirms deleting an API without flows; a refusal stays in the dialog. */
export function DeleteApiDialog({ api, onClose, onDeleted }: DeleteApiDialogProps) {
  const t = useT();
  const remove = useDeleteApi();

  async function confirm() {
    if (!api || remove.isPending) return;
    try {
      await remove.mutateAsync(api);
    } catch {
      return; // shown in the dialog
    }
    remove.reset();
    onDeleted(api);
  }

  function close() {
    remove.reset();
    onClose();
  }

  return (
    <Dialog
      open={api !== undefined}
      title={t("common.deleteTitle", { name: api?.name ?? "" })}
      description={t("apis.deleteDescription")}
      onClose={close}
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => void confirm()}>
            {t("apis.delete")}
          </Button>
        </>
      }
    >
      {remove.isError ? <Alert>{errorMessage(remove.error)}</Alert> : null}
    </Dialog>
  );
}
