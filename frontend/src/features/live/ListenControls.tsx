import type { Mix } from "@/lib/live/audio";
import { Badge, Button, SegmentedControl, VolumeIcon, type SegmentOption } from "@/ui";

const MIXES: readonly SegmentOption<Mix>[] = [
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

function HeadphonesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="5" height="7" rx="1.5" />
      <rect x="16" y="14" width="5" height="7" rx="1.5" />
    </svg>
  );
}

/** The listening bar: start (a click, so the browser allows audio), pick the mix, set the volume. */
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-raised px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-evaluator">
          <HeadphonesIcon />
        </span>
        {listening ? (
          <>
            <span className="text-[13px] font-medium">Listening</span>
            <Button variant="secondary" className="min-h-[34px] px-3 text-xs" onClick={onStop}>
              Stop listening
            </Button>
          </>
        ) : (
          <Button className="min-h-[34px] px-3 text-xs" icon={<VolumeIcon size={14} />} onClick={onListen} disabled={disabled}>
            Listen
          </Button>
        )}
        <SegmentedControl label="Audio mix" options={MIXES} value={mix} onChange={onMix} />
        {skipped ? (
          <span title="The connection fell behind, so some audio was skipped. The transcript is complete.">
            <Badge tone="muted">Audio skipped</Badge>
          </span>
        ) : null}
      </div>
      <label className="flex items-center gap-2.5 text-xs text-muted">
        Volume
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          onChange={(event) => onVolume(Number(event.target.value) / 100)}
          className="w-[120px] accent-evaluator"
        />
      </label>
    </div>
  );
}
