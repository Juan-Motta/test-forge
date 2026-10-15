"use client";

import { useT } from "@/lib/i18n";
import { cn, focusRing } from "./cn";

export type PinTone = "danger" | "warn" | "muted";

const TONE: Record<PinTone, string> = {
  danger: "bg-danger",
  warn: "bg-evaluator",
  muted: "bg-muted",
};

type PinProps = {
  n: number | string;
  tone?: PinTone;
  size?: "sm" | "md";
  /** Accessible name when interactive; defaults to "Issue {n}" (translated). */
  label?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
};

/** Numbered circle marking an issue on a timeline or a transcript turn. */
export function Pin({ n, tone = "danger", size = "md", label, href, onClick, className }: PinProps) {
  const t = useT();
  const classes = cn(
    "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-ground no-underline hover:text-ground",
    size === "md" ? "size-[22px] text-[11px]" : "size-[18px] text-[10px]",
    TONE[tone],
    className,
  );
  const name = label ?? t("ui.issue", { n });

  if (href) {
    return (
      <a href={href} aria-label={name} className={cn(classes, focusRing)}>
        {n}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" aria-label={name} onClick={onClick} className={cn(classes, "cursor-pointer", focusRing)}>
        {n}
      </button>
    );
  }
  return <span className={classes}>{n}</span>;
}
