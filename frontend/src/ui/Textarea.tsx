import type { Ref, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";
import { fieldControlClasses } from "./Input";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>;
  mono?: boolean;
};

export function Textarea({ mono = false, className, ref, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={fieldControlClasses(cn("py-2.5 leading-relaxed", mono && "font-mono", className))}
      {...props}
    />
  );
}
