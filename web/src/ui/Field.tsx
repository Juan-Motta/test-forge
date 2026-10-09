"use client";

import { useId, type ReactNode } from "react";

/** Props a Field hands to its control so label, hint and error are wired accessibly. */
export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (control: FieldControlProps) => ReactNode;
};

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children({
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <p id={errorId} className="text-xs text-danger-fg">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-dim">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
