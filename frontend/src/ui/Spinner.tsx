import { cn } from "./cn";

type SpinnerProps = { size?: number; className?: string; label?: string };

/** Decorative unless `label` is given, in which case it is announced as a status. */
export function Spinner({ size = 16, className, label }: SpinnerProps) {
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("animate-spin motion-reduce:animate-none", className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (!label) return svg;
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      {svg}
      <span>{label}</span>
    </span>
  );
}
