import { clock, endReasonLabel, isActive, runDurationMs } from "@/features/runs/format";
import { RunStatusChip } from "@/features/runs/RunStatusChip";
import type { Run } from "@/features/runs/types";
import { cn, focusRing } from "@/ui";

/** One session in the live list: pick it to focus (and listen to) that run. */
export function SessionCard({ run, selected, now, onSelect }: { run: Run; selected: boolean; now: number; onSelect: () => void }) {
  const duration = runDurationMs(run, now);
  let meta: string;
  if (run.status === "queued") meta = "Starts when a slot frees up";
  else if (isActive(run.status)) meta = duration === null ? "Starting…" : clock(duration);
  else meta = [duration === null ? null : clock(duration), endReasonLabel(run.endReason)].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-xl border p-3.5 text-left transition-colors",
        focusRing,
        selected ? "border-evaluator bg-active" : "border-line bg-panel hover:bg-raised",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold">{run.scenarioName}</span>
        <RunStatusChip status={run.status} />
      </span>
      <span className="text-xs text-muted">{run.agentName}</span>
      <span className="font-mono text-xs text-dim">{meta}</span>
    </button>
  );
}
