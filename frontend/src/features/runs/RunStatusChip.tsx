import { Badge } from "@/ui";
import { STATUS_LABELS, STATUS_TONES, isActive } from "./format";
import type { RunStatus } from "./types";

/** Status pill; active runs get a pulsing dot. */
export function RunStatusChip({ status }: { status: RunStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]}>
      {isActive(status) && status !== "queued" ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
      ) : null}
      {STATUS_LABELS[status]}
    </Badge>
  );
}
