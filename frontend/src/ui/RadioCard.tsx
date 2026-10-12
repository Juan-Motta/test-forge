import { useId, type ReactNode } from "react";
import { cn } from "./cn";

type RadioCardProps<T extends string> = {
  name: string;
  value: T;
  checked: boolean;
  onChange: (value: T) => void;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/** A native radio drawn as a selectable card: title (its name) and description (its description). */
export function RadioCard<T extends string>({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  disabled,
  className,
}: RadioCardProps<T>) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-[10px] border p-3.5 transition-colors",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-evaluator",
        checked ? "border-evaluator bg-selected" : "border-field-line bg-field hover:border-line-strong",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="mt-[3px] accent-evaluator outline-none"
      />
      <span className="flex flex-col gap-1">
        <span id={titleId} className="text-sm font-semibold">
          {title}
        </span>
        {description ? (
          <span id={descriptionId} className="text-xs leading-normal text-muted">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/** Groups RadioCards under one accessible name, in a responsive grid. */
export function RadioCardGroup({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]", className)}>
      {children}
    </div>
  );
}
