import { cn } from "./cn";
import { SCORE_FILL, SCORE_TEXT, scoreTone } from "./score";

type ScoreBarProps = {
  /** 0-100; null while there is no score (empty track, "—"). */
  score: number | null;
  /** Accessible name of the meter (e.g. the criterion). */
  label: string;
  /** Prints the value before the track. */
  showValue?: boolean;
  /** Colours the printed value by its band (the criteria list); otherwise it stays foreground. */
  toneValue?: boolean;
  /** Track width classes; defaults to filling the row. */
  trackClassName?: string;
  className?: string;
};

/** A 0-100 score as a 6px track filled in its band colour, exposed as a meter. */
export function ScoreBar({ score, label, showValue = false, toneValue = false, trackClassName, className }: ScoreBarProps) {
  const value = score === null ? null : Math.round(Math.min(100, Math.max(0, score)));
  const tone = value === null ? undefined : scoreTone(value);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {showValue ? (
        <span
          aria-hidden="true"
          className={cn("w-7 shrink-0 font-semibold tabular-nums", toneValue && tone ? SCORE_TEXT[tone] : "text-fg")}
        >
          {value ?? "—"}
        </span>
      ) : null}
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value === null ? "Not scored" : undefined}
        data-tone={tone}
        className={cn("block h-1.5 overflow-hidden rounded-[3px] bg-field-border", trackClassName ?? "flex-1")}
      >
        <span data-fill className={cn("block h-full", tone && SCORE_FILL[tone])} style={{ width: `${value ?? 0}%` }} />
      </span>
    </div>
  );
}
