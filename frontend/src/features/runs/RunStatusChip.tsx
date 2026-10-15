import { useT } from "@/lib/i18n";
import { Badge } from "@/ui";
import { STATUS_TONES, isActive, statusLabel } from "./format";
import type { RunStatus } from "./types";

/** Status pill; active runs get a pulsing dot. */
export function RunStatusChip({ status }: { status: RunStatus }) {
  const t = useT();
  return (
    <Badge tone={STATUS_TONES[status]}>
      {isActive(status) && status !== "queued" ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
      ) : null}
      {statusLabel(t, status)}
    </Badge>
  );
}
