import { useT } from "@/lib/i18n";
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
  const t = useT();
  return (
    <Dialog
      open={open}
      title={t("rerun.title")}
      description={
        <>
          {`${t("rerun.what", { scenario: scenarioName, agent: agentName })} `}
          {t("rerun.billed")}
        </>
      }
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={pending} onClick={onConfirm}>
            {t("rerun.confirm")}
          </Button>
        </>
      }
    >
      {error ? (
        <Alert title={t("rerun.failed")}>
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
