"use client";

import { useRef } from "react";
import { cn, focusRing } from "./cn";
import { rovingIndex } from "./roving";

export type SegmentOption<T extends string> = { value: T; label: string };

type SegmentedControlProps<T extends string> = {
  /** Accessible name of the group. */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** "sm" (default) for toolbars; "md" lines up with the 44px form fields (Input, Select). */
  size?: "sm" | "md";
  className?: string;
};

/** One-of-many switch drawn as joined segments, with radio-group semantics and arrow keys. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, size = "sm", className }: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // An unknown value checks nothing; the first option then stays the group's Tab stop.
  const selected = options.findIndex((option) => option.value === value);
  const tabStop = Math.max(0, selected);

  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex gap-0.5 rounded-lg bg-sidebar p-[3px]", className)}>
      {options.map((option, index) => {
        const checked = index === selected;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const next = rovingIndex(event, index, options.length);
              if (next === null) return;
              event.preventDefault();
              refs.current[next]?.focus();
              onChange(options[next].value);
            }}
            className={cn(
              "cursor-pointer rounded-md font-medium transition-colors",
              size === "md" ? "min-h-[38px] px-4 text-sm" : "min-h-[34px] px-3 text-xs",
              focusRing,
              checked ? "bg-chip text-fg" : "text-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
