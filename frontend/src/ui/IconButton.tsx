import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn, focusRing } from "./cn";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  /** Required: an icon-only button needs an accessible name. */
  label: string;
  icon: ReactNode;
};

export function IconButton({ label, icon, type = "button", className, ...props }: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      // After the spread: TypeScript does not check hyphenated JSX attributes, so a stray
      // `aria-label` could otherwise replace the label.
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors",
        "hover:bg-active hover:text-fg disabled:cursor-not-allowed disabled:opacity-60",
        focusRing,
        className,
      )}
    >
      {icon}
    </button>
  );
}
