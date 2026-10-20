import type { Mix } from "@/lib/live/audio";
import { useT } from "@/lib/i18n";
import { Badge, Button, SegmentedControl, VolumeIcon } from "@/ui";

const MIXES = [
  { value: "both", label: "live.mix.both" },
  { value: "agent", label: "live.mix.agent" },
  { value: "caller", label: "live.mix.caller" },
] as const satisfies readonly { value: Mix; label: string }[];

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
  const t = useT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-raised px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-evaluator-fg">
          <HeadphonesIcon />
        </span>
        {listening ? (
          <>
            <span className="text-[13px] font-medium">{t("live.listening")}</span>
            <Button variant="secondary" className="min-h-[34px] px-3 text-xs" onClick={onStop}>
              {t("live.stopListening")}
            </Button>
          </>
        ) : (
          <Button className="min-h-[34px] px-3 text-xs" icon={<VolumeIcon size={14} />} onClick={onListen} disabled={disabled}>
            {t("live.listen")}
          </Button>
        )}
        <SegmentedControl
          label={t("live.mix")}
          options={MIXES.map((option) => ({ value: option.value, label: t(option.label) }))}
          value={mix}
          onChange={onMix}
        />
        {skipped ? (
          <span title={t("live.skippedHint")}>
            <Badge tone="muted">{t("live.skipped")}</Badge>
          </span>
        ) : null}
      </div>
      <label className="flex items-center gap-2.5 text-xs text-muted">
        {t("live.volume")}
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
