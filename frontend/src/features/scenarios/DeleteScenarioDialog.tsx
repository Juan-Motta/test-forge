"use client";

import { useT } from "@/lib/i18n";
import { Alert, Button, Dialog } from "@/ui";
import type { Scenario } from "./types";

type DeleteScenarioDialogProps = {
  scenario: Scenario | undefined;
  onCancel: () => void;
  onConfirm: (scenario: Scenario) => void;
  pending: boolean;
  error?: string;
};

/** Confirmation naming the scenario; nothing is deleted until the user confirms. */
export function DeleteScenarioDialog({ scenario, onCancel, onConfirm, pending, error }: DeleteScenarioDialogProps) {
  const t = useT();
  return (
    <Dialog
      open={scenario !== undefined}
      title={scenario ? t("common.deleteTitle", { name: scenario.name }) : ""}
      description={t("scenarios.deleteDescription")}
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={pending} onClick={() => scenario && onConfirm(scenario)}>
            {pending ? t("common.deleting") : t("scenarios.delete")}
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
    </Dialog>
  );
}
