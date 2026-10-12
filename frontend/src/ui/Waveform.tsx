import { cn } from "./cn";

export type WaveTone = "agent" | "evaluator" | "neutral";
export type WaveBarTone = WaveTone | "silent";

const BAR_COLOR: Record<WaveBarTone, string> = {
  agent: "bg-agent",
  evaluator: "bg-evaluator",
  neutral: "bg-muted",
  silent: "bg-idle",
};

const MIN_BAR_PX = 3;

type WaveformProps = {
  /** Levels 0..1, one bar each (values outside are clamped). */
  values: number[];
  /** Colour of every bar (single-tone lanes). */
  tone?: WaveTone;
  /** Per-bar speaker for two-tone waveforms; "silent" draws a flat, dimmed bar. Overrides `tone`. */
  tones?: WaveBarTone[];
  /** Played share 0..1: bars before it are full strength, the rest dimmed. Omitted: all full. */
  progress?: number;
  /** Lane height in px (the tallest bar). */
  height?: number;
  /** Gap between bars in px. */
  gap?: 1 | 2;
  /** Text alternative read instead of the (decorative) bars. */
  label?: string;
  className?: string;
};

/** Bars from audio levels. Purely visual: screen readers get `label` only. */
export function Waveform({ values, tone = "agent", tones, progress, height = 40, gap = 2, label, className }: WaveformProps) {
  const playedUntil = progress === undefined ? values.length : Math.round(Math.min(1, Math.max(0, progress)) * values.length);

  return (
    <div className={cn("min-w-0", className)}>
      <div aria-hidden="true" className={cn("flex items-center", gap === 1 ? "gap-px" : "gap-0.5")} style={{ height }}>
        {values.map((level, index) => {
          const barTone = tones?.[index] ?? tone;
          const silent = barTone === "silent";
          const played = index < playedUntil;
          const px = silent ? MIN_BAR_PX : Math.max(MIN_BAR_PX, Math.round(Math.min(1, Math.max(0, level)) * height));
          return (
            <span
              // Bars are positional; the index is their identity.
              key={index}
              data-bar
              data-tone={barTone}
              data-played={played || undefined}
              className={cn(
                "block flex-1 rounded-[1px]",
                BAR_COLOR[barTone],
                silent ? "opacity-35" : played ? "opacity-100" : "opacity-40",
              )}
              style={{ height: `${px}px` }}
            />
          );
        })}
      </div>
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}
