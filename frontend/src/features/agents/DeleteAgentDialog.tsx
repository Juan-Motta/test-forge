"use client";

import { useT } from "@/lib/i18n";
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
  const t = useT();
  return (
    <Dialog
      open={agent !== undefined}
      title={agent ? t("common.deleteTitle", { name: agent.name }) : ""}
      description={t("agents.deleteDescription")}
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={pending} onClick={() => agent && onConfirm(agent)}>
            {pending ? t("common.deleting") : t("agents.delete")}
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
