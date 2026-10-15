import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn, focusRing } from "./cn";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  /** Required: an icon-only button needs an accessible name. */
  label: string;
  icon: ReactNode;
  /** "xs" (20px) inside chips, "sm" (28px) in dense places such as table cells, "md" (44px) by default. */
  size?: "md" | "sm" | "xs";
};

export function IconButton({ label, icon, size = "md", type = "button", className, ...props }: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      // After the spread: TypeScript does not check hyphenated JSX attributes, so a stray
      // `aria-label` could otherwise replace the label.
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-muted transition-colors",
        size === "xs" ? "size-5 rounded" : size === "sm" ? "size-7 rounded-md" : "size-11 rounded-lg",
        "hover:bg-active hover:text-fg disabled:cursor-not-allowed disabled:opacity-60",
        focusRing,
        className,
      )}
    >
      {icon}
    </button>
  );
}
