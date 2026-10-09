"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type DialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** Free-form body, e.g. a form that renders its own buttons. */
  children?: ReactNode;
  /** Buttons for a confirmation, laid out as the dialog's action row. */
  actions?: ReactNode;
  /** `lg` fits forms; `md` fits confirmations. */
  size?: "md" | "lg";
};

const SIZES = { md: "w-[min(28rem,calc(100vw-2rem))]", lg: "w-[min(36rem,calc(100vw-2rem))]" } as const;

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Modal dialog on the native `<dialog>`: focus moves inside, Tab cycles within, Escape closes,
 * and focus returns to whatever opened it.
 */
export function Dialog({ open, ...props }: DialogProps) {
  return open ? <OpenDialog {...props} /> : null;
}

function OpenDialog({ title, description, onClose, children, actions, size = "md" }: Omit<DialogProps, "open">) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    (focusables(dialog)[0] ?? dialog).focus();
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      opener?.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      tabIndex={-1}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-panel p-6 text-fg shadow-2xl",
        SIZES[size],
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="text-sm leading-relaxed text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {children}
        {actions ? <div className="flex flex-wrap justify-end gap-3">{actions}</div> : null}
      </div>
    </dialog>
  );
}
