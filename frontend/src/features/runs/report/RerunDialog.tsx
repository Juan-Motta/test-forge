import { Alert, Button, Dialog } from "@/ui";

type RerunDialogProps = {
  open: boolean;
  scenarioName: string;
  agentName: string;
  onConfirm: () => void;
  onClose: () => void;
  pending: boolean;
  /** Why the re-run was refused, and the scenario's not-runnable reasons (422). */
  error: { message: string; reasons: string[] } | null;
};

/** Confirms a re-run: it is a new, paid run of the scenario as it is now. */
export function RerunDialog({ open, scenarioName, agentName, onConfirm, onClose, pending, error }: RerunDialogProps) {
  return (
    <Dialog
      open={open}
      title="Start a new paid run?"
      description={
        <>
          {`This runs “${scenarioName}” against ${agentName} once more, with the scenario as it is now. `}
          It is a new run: it reaches the agent and uses the evaluator (and, for a call, speech) models, which are billed.
        </>
      }
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={onConfirm}>
            Start paid run
          </Button>
        </>
      }
    >
      {error ? (
        <Alert title="Could not re-run">
          <span className="block">{error.message}</span>
          {error.reasons.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {error.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
    </Dialog>
  );
}
