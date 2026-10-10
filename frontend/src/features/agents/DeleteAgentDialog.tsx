"use client";

import { Alert, Button, Dialog } from "@/ui";
import type { Agent } from "./types";

type DeleteAgentDialogProps = {
  agent: Agent | undefined;
  onCancel: () => void;
  onConfirm: (agent: Agent) => void;
  pending: boolean;
  error?: string;
  /** What to do about `error` (e.g. delete the scenarios that still use the agent). */
  errorHint?: string;
};

/** Confirmation naming the agent; nothing is deleted until the user confirms. */
export function DeleteAgentDialog({ agent, onCancel, onConfirm, pending, error, errorHint }: DeleteAgentDialogProps) {
  return (
    <Dialog
      open={agent !== undefined}
      title={agent ? `Delete “${agent.name}”?` : ""}
      description="An agent can be deleted only when no scenario uses it. This cannot be undone."
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={() => agent && onConfirm(agent)}>
            {pending ? "Deleting…" : "Delete agent"}
          </Button>
        </>
      }
    >
      {error ? (
        <Alert>
          <span className="block">{error}</span>
          {errorHint ? <span className="block">{errorHint}</span> : null}
        </Alert>
      ) : null}
    </Dialog>
  );
}
