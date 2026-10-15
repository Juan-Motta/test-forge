"use client";

import { useRef } from "react";
import { useT } from "@/lib/i18n";
import { Dialog } from "@/ui";
import { LaunchPanel, type LaunchScenario } from "./LaunchPanel";
import type { BatchDetail } from "./types";

type LaunchRunsDialogProps = {
  open: boolean;
  /** Saved scenarios to launch, in order. */
  scenarios: LaunchScenario[];
  onClose: () => void;
  onLaunched: (batch: BatchDetail) => void;
};

/** Launches a batch from a dialog: every scenario × runs each, at most "in parallel" at a time. */
export function LaunchRunsDialog({ open, scenarios, onClose, onLaunched }: LaunchRunsDialogProps) {
  if (!open) return null;
  return <LaunchDialog scenarios={scenarios} onClose={onClose} onLaunched={onLaunched} />;
}

function LaunchDialog({ scenarios, onClose, onLaunched }: Omit<LaunchRunsDialogProps, "open">) {
  // While a launch is in flight the dialog stays open: closing would unmount the panel and drop
  // both its double-submit guard and the redirect to the new batch (each run is a real, paid call).
  const t = useT();
  const busy = useRef(false);
  const close = () => {
    if (!busy.current) onClose();
  };
  const title =
    scenarios.length === 1
      ? t("launch.titleOne", { name: scenarios[0].name })
      : t("launch.titleMany", { count: scenarios.length });

  return (
    <Dialog
      open
      size="lg"
      title={title}
      description={t("launch.description")}
      onClose={close}
    >
      <LaunchPanel
        scenarios={scenarios}
        onLaunched={onLaunched}
        onCancel={close}
        onBusyChange={(value) => (busy.current = value)}
      />
    </Dialog>
  );
}
