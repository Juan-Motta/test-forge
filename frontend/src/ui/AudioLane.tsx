"use client";

import { useT } from "@/lib/i18n";
import { cn } from "./cn";
import { Pin, type PinTone } from "./Pin";
import { Waveform } from "./Waveform";

export type LanePin = {
  n: number | string;
  /** Position on the lane, 0..1. */
  at: number;
  tone?: PinTone;
  label?: string;
  href?: string;
  onClick?: () => void;
};

type AudioLaneProps = {
  /** Speaker name shown in the label column ("Agent", "Evaluator"). */
  label: string;
  tone: "agent" | "evaluator";
  values: number[];
  progress?: number;
  height?: number;
  /** Text alternative for the waveform; defaults to "{label} audio levels" (translated). */
  description?: string;
  /** Evenly spaced time labels under the lane (first at the start, last at the end). */
  axis?: string[];
  /** Issue pins on a row under the lane. */
  pins?: LanePin[];
  /** Label of the pins row; defaults to "Issues" (translated). */
  pinsLabel?: string;
  className?: string;
};

const LABEL_COL = "w-[74px] shrink-0 text-xs";

/** One speaker's audio lane: label column, waveform, optional issue pins and time axis. */
export function AudioLane({
  label,
  tone,
  values,
  progress,
  height = 40,
  description,
  axis,
  pins,
  pinsLabel,
  className,
}: AudioLaneProps) {
  const t = useT();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-3">
        <span className={cn(LABEL_COL, "font-semibold", tone === "agent" ? "text-agent-fg" : "text-evaluator-fg")}>{label}</span>
        <Waveform
          className="flex-1"
          values={values}
          tone={tone}
          progress={progress}
          height={height}
          gap={1}
          label={description ?? t("ui.audioLevels", { label })}
        />
      </div>
      {pins ? (
        <div className="flex items-center gap-3">
          <span className={cn(LABEL_COL, "text-dim")}>{pinsLabel ?? t("ui.issues")}</span>
          <div className="relative h-[26px] flex-1 border-t border-field-border">
            {pins.map((pin) => (
              <span
                key={pin.n}
                className="absolute top-1 -translate-x-1/2"
                style={{ left: `${Math.min(1, Math.max(0, pin.at)) * 100}%` }}
              >
                <Pin n={pin.n} tone={pin.tone} label={pin.label} href={pin.href} onClick={pin.onClick} />
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {axis ? (
        <div className="flex justify-between pl-[86px] font-mono text-[11px] text-faint">
          {axis.map((tick, index) => (
            // Ticks may repeat ("now"); their position is their identity.
            <span key={index}>{tick}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
