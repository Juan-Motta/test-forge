import { useId, type ReactNode } from "react";
import { cn } from "./cn";

export type KpiTrend = "up" | "down" | "flat";

export type KpiDelta = {
  text: string;
  trend: KpiTrend;
  /** Which direction is an improvement (default "up"; "down" for latency, failures…). */
  goodWhen?: "up" | "down";
};

type KpiTileProps = {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: KpiDelta;
  /** Secondary line under the delta (e.g. "12 judged"). */
  sub?: ReactNode;
  /** A small icon beside the label that identifies the metric (decorative). */
  icon?: ReactNode;
  className?: string;
};

const QUALITY_CLASS = { better: "text-success-fg", worse: "text-danger-fg", neutral: "text-muted" } as const;

/** Key metric tile: label, big value with unit, a delta coloured by whether it is an improvement. */
export function KpiTile({ label, value, unit, delta, sub, icon, className }: KpiTileProps) {
  const labelId = useId();
  const quality = delta ? deltaQuality(delta) : "neutral";

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn("flex flex-col gap-2.5 rounded-xl border border-line bg-panel px-5 py-[18px]", className)}
    >
      <div className="flex items-center gap-2">
        {icon ? (
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-tag text-muted">
            {icon}
          </span>
        ) : null}
        <span id={labelId} className="text-[13px] text-muted">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[34px] leading-none font-semibold tracking-[-0.02em] tabular-nums">{value}</span>
        {unit ? <span className="text-[15px] text-dim">{unit}</span> : null}
      </div>
      {delta ? (
        <span data-trend={delta.trend} data-quality={quality} className={cn("text-xs", QUALITY_CLASS[quality])}>
          {delta.text}
          {quality !== "neutral" ? <span className="sr-only"> ({quality})</span> : null}
        </span>
      ) : null}
      {sub ? <span className="text-xs text-dim">{sub}</span> : null}
    </div>
  );
}

function deltaQuality({ trend, goodWhen = "up" }: KpiDelta): "better" | "worse" | "neutral" {
  if (trend === "flat") return "neutral";
  return trend === goodWhen ? "better" : "worse";
}
