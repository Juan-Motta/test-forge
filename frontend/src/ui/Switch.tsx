"use client";

import { useId } from "react";
import { cn, focusRing } from "./cn";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name, shown next to the track. */
  label: string;
  /** One short line under the label (the control's description). */
  hint?: string;
  className?: string;
};

/** An on/off option drawn as a sliding track, with switch semantics. */
export function Switch({ checked, onChange, label, hint, className }: SwitchProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={hint ? `${id}-hint` : undefined}
      onClick={() => onChange(!checked)}
      className={cn("inline-flex min-h-11 items-center gap-2.5 rounded-lg text-left", focusRing, className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-evaluator" : "bg-line-strong",
        )}
      >
        <span
          className={cn("size-4 rounded-full bg-fg shadow-sm transition-transform", checked && "translate-x-4 bg-on-evaluator")}
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={`${id}-label`} className="text-[13px] font-medium">
          {label}
        </span>
        {hint ? (
          <span id={`${id}-hint`} className="text-xs text-dim">
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}
