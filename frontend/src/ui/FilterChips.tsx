import { cn, focusRing } from "./cn";

export type FilterChipOption<T extends string> = { value: T; label: string; count?: number };

type FilterChipsProps<T extends string> = {
  /** Accessible name of the group. */
  label: string;
  options: readonly FilterChipOption<T>[];
  /** Pressed values (one for a single-choice filter, several for a multi-select). */
  selected: readonly T[];
  onToggle: (value: T) => void;
  /** "neutral" (grey pressed chip, filters) or "evaluator" (amber, persona-like picks). */
  tone?: "neutral" | "evaluator";
  size?: "sm" | "md";
  className?: string;
};

/** Pill toggle buttons (aria-pressed) for filters and quick picks. */
export function FilterChips<T extends string>({
  label,
  options,
  selected,
  onToggle,
  tone = "neutral",
  size = "sm",
  className,
}: FilterChipsProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((option) => {
        const pressed = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onToggle(option.value)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 transition-colors",
              size === "sm" ? "min-h-8 text-xs" : "min-h-9 text-[13px]",
              focusRing,
              pressed
                ? tone === "evaluator"
                  ? "border-evaluator/40 bg-evaluator/16 font-medium text-evaluator-fg"
                  : "border-transparent bg-chip font-medium text-fg"
                : "border-chip bg-transparent text-muted hover:text-fg",
            )}
          >
            {option.label}
            {option.count !== undefined ? <span className="font-mono text-[11px] text-dim">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
