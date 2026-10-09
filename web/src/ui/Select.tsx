import type { Ref, SelectHTMLAttributes } from "react";
import { cn } from "./cn";
import { ChevronDownIcon } from "./icons";
import { fieldControlClasses } from "./Input";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> };

export function Select({ className, ref, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select ref={ref} className={fieldControlClasses(cn("appearance-none pr-10", className))} {...props}>
        {children}
      </select>
      <ChevronDownIcon
        size={14}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-dim"
      />
    </div>
  );
}
