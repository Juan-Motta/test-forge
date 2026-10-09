import type { ReactNode } from "react";
import { cn } from "./cn";
import { AlertIcon, CheckIcon } from "./icons";

type AlertProps = { tone?: "danger" | "success" | "info"; title?: string; children: ReactNode; className?: string };

const TONES = {
  danger: "border-danger/40 bg-danger/10 text-danger-fg",
  success: "border-success/40 bg-success/10 text-success-fg",
  info: "border-line-strong bg-raised text-fg",
} as const;

/** Inline message. Errors use role="alert" so they are announced as soon as they appear. */
export function Alert({ tone = "danger", title, children, className }: AlertProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm", TONES[tone], className)}
    >
      {tone === "success" ? <CheckIcon size={16} className="mt-0.5" /> : <AlertIcon size={16} className="mt-0.5" />}
      <div className="flex flex-col gap-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
