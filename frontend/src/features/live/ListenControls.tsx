import type { Mix } from "@/lib/live/audio";
import { Badge, Button, VolumeIcon, cn, focusRing } from "@/ui";

const MIXES: { value: Mix; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "agent", label: "Agent only" },
  { value: "caller", label: "Evaluator only" },
];

type ListenControlsProps = {
  listening: boolean;
  disabled: boolean;
  onListen: () => void;
  onStop: () => void;
  mix: Mix;
  onMix: (mix: Mix) => void;
  volume: number;
  onVolume: (volume: number) => void;
  /** The server dropped audio for this browser recently. */
  skipped: boolean;
};

/** Listen in: start (a click, so the browser allows audio), pick the mix, set the volume. */
export function ListenControls({
  listening,
  disabled,
  onListen,
  onStop,
  mix,
  onMix,
  volume,
  onVolume,
  skipped,
}: ListenControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2.5">
      {listening ? (
        <Button variant="secondary" className="min-h-9 px-3" onClick={onStop}>
          Stop listening
        </Button>
      ) : (
        <Button className="min-h-9 px-3" icon={<VolumeIcon size={16} />} onClick={onListen} disabled={disabled}>
          Listen
        </Button>
      )}
      <div role="group" aria-label="Audio mix" className="inline-flex rounded-lg border border-line-strong p-0.5">
        {MIXES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mix === option.value}
            onClick={() => onMix(option.value)}
            className={cn(
              "min-h-8 rounded-md px-3 text-xs transition-colors",
              focusRing,
              mix === option.value ? "bg-chip text-fg" : "text-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          onChange={(event) => onVolume(Number(event.target.value) / 100)}
          className="w-28 accent-evaluator"
        />
      </label>
      {skipped ? (
        <span title="The connection fell behind, so some audio was skipped. The transcript is complete.">
          <Badge>Audio skipped</Badge>
        </span>
      ) : null}
    </div>
  );
}
