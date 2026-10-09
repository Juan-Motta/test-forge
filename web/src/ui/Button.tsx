import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn, focusRing } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-evaluator text-on-evaluator font-semibold hover:bg-evaluator-hover",
  secondary: "border border-line-strong bg-transparent text-fg hover:bg-active",
  danger: "bg-danger text-on-danger font-semibold hover:bg-danger-fg",
  ghost: "bg-transparent text-muted hover:bg-active hover:text-fg",
};

export const buttonClasses = (variant: ButtonVariant = "primary", className?: string) =>
  cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium",
    "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    focusRing,
    VARIANTS[variant],
    className,
  );

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Disables the button and shows a spinner; pair it with a "…ing" label for screen readers. */
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = "primary",
  loading = false,
  icon,
  type = "button",
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, className)}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}
