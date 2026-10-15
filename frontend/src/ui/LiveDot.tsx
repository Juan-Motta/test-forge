import { cn } from "./cn";

type LiveDotProps = {
  /** Read by screen readers (e.g. "Live"); without it the dot is decorative. */
  label?: string;
  className?: string;
};

/** Pulsing red "live" dot with a soft halo. The pulse stops under prefers-reduced-motion. */
export function LiveDot({ label, className }: LiveDotProps) {
  return (
    <span aria-hidden={label ? undefined : true} className={cn("relative inline-flex size-2.5 shrink-0", className)}>
      <span className="absolute inset-0 rounded-full bg-danger opacity-60 motion-safe:animate-ping" />
      <span className="relative size-2.5 rounded-full bg-danger shadow-[0_0_0_4px_color-mix(in_srgb,var(--ve-danger)_18%,transparent)]" />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
