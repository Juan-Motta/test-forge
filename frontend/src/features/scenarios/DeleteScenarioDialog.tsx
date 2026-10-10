"use client";

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
  return (
    <Dialog
      open={scenario !== undefined}
      title={scenario ? `Delete “${scenario.name}”?` : ""}
      description="Its persona, facts and criteria are removed. This cannot be undone."
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={() => scenario && onConfirm(scenario)}>
            {pending ? "Deleting…" : "Delete scenario"}
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
    </Dialog>
  );
}
