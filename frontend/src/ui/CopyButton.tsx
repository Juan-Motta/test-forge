"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "./cn";
import { IconButton } from "./IconButton";
import { CheckIcon, CopyIcon } from "./icons";

export type CopyState = "idle" | "copied" | "failed";

/** How long the copy confirmation stays before returning to idle. */
const CONFIRMATION_MS = 2000;

/** Copies text to the clipboard; the state says how the last copy went, for a while. */
export function useClipboard(): [CopyState, (text: string) => Promise<void>] {
  const [state, setState] = useState<CopyState>("idle");
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(reset.current), []);

  async function copy(text: string) {
    // Clear first so a repeated copy changes the live region and is announced again.
    clearTimeout(reset.current);
    setState("idle");
    let next: CopyState;
    try {
      await navigator.clipboard.writeText(text);
      next = "copied";
    } catch {
      next = "failed";
    }
    setState(next);
    reset.current = setTimeout(() => setState("idle"), CONFIRMATION_MS);
  }

  return [state, copy];
}

type CopyButtonProps = {
  text: string;
  /** Accessible name, e.g. "Copy thread id". */
  label: string;
  /** Announced (politely) once copied (default "Copied", translated). */
  copiedMessage?: string;
  iconSize?: number;
  /** The button's size; "sm" for dense places such as table cells. */
  size?: "md" | "sm";
  className?: string;
};

/** An icon button that copies `text`, with a screen-reader confirmation. */
export function CopyButton({ text, label, copiedMessage, iconSize = 16, size, className }: CopyButtonProps) {
  const t = useT();
  const [state, copy] = useClipboard();
  return (
    <>
      <IconButton
        label={label}
        size={size}
        className={cn(className)}
        icon={state === "copied" ? <CheckIcon size={iconSize} /> : <CopyIcon size={iconSize} />}
        onClick={() => void copy(text)}
      />
      <span role="status" className="sr-only">
        {state === "copied" ? (copiedMessage ?? t("ui.copied")) : state === "failed" ? t("ui.copyFailed") : ""}
      </span>
    </>
  );
}
