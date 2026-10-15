import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "./cn";
import { SearchIcon } from "./icons";

type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Accessible name (visually hidden; the placeholder carries the hint). */
  label: string;
  ref?: Ref<HTMLInputElement>;
  /** Classes of the outer field (width, etc.). */
  className?: string;
};

/** Search input with a leading magnifier, framed like the design's header search. */
export function SearchField({ label, className, ref, ...props }: SearchFieldProps) {
  return (
    <label
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-lg border border-field-line bg-panel px-3 text-dim",
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-evaluator",
        className,
      )}
    >
      <SearchIcon size={16} strokeWidth={2} />
      <span className="sr-only">{label}</span>
      <input
        ref={ref}
        type="search"
        className="w-full min-w-0 border-0 bg-transparent text-sm text-fg outline-none placeholder:text-dim"
        {...props}
      />
    </label>
  );
}
