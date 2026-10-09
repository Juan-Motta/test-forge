import type { InputHTMLAttributes, Ref } from "react";
import { cn, focusRing } from "./cn";

export const fieldControlClasses = (className?: string) =>
  cn(
    "w-full min-h-11 rounded-lg border border-field-line bg-field px-3 text-sm text-fg placeholder:text-dim",
    "aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-60",
    focusRing,
    className,
  );

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement>;
  /** Monospace for ids, URLs, keys and numbers. */
  mono?: boolean;
};

export function Input({ mono = false, className, ref, ...props }: InputProps) {
  return <input ref={ref} className={fieldControlClasses(cn(mono && "font-mono", className))} {...props} />;
}
