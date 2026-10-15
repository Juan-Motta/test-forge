import { runKind } from "@/features/runs/kind";
import type { Run } from "@/features/runs/types";
import { dominantTones, type ChannelLevels } from "@/lib/live/levels";
import { useT } from "@/lib/i18n";
import { Badge, Waveform, cn, focusRing } from "@/ui";
import { sessionChip, sessionMeta, type SessionStats } from "./live-view";

type SessionCardProps = {
  run: Run;
  selected: boolean;
  now: number;
  onSelect: () => void;
  /** Recent audio levels; only the focused run streams its audio, so only its card has them. */
  levels?: ChannelLevels;
  /** Turns and latency from the focused run's stream. */
  stats?: SessionStats;
};

/** One session in the live list: pick it to focus (and, for a call, listen to) that run. */
export function SessionCard({ run, selected, now, onSelect, levels, stats }: SessionCardProps) {
  const t = useT();
  const chip = sessionChip(t, run);
  // Text runs stream no audio: no levels to draw.
  const wave = levels && run.status === "running" && runKind(run) !== "text" ? dominantTones(levels) : null;
  const who = [run.persona, run.agentName].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex h-full w-full flex-col gap-2.5 rounded-[10px] border px-4 py-3.5 text-left transition-colors",
        focusRing,
        selected ? "border-evaluator bg-active" : "border-line bg-panel hover:bg-raised",
      )}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate text-sm font-semibold">{run.scenarioName}</span>
          <span className="truncate text-xs text-muted">{who}</span>
        </span>
        <Badge tone={chip.tone}>{chip.label}</Badge>
      </span>
      {wave ? (
        <Waveform values={wave.values} tones={wave.tones} height={26} label={t("live.recentLevels")} className="w-full" />
      ) : null}
      <span className="font-mono text-xs text-dim">{sessionMeta(t, run, now, selected ? stats : undefined)}</span>
    </button>
  );
}
