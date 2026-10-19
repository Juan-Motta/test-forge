"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconButton, PencilIcon, cn } from "@/ui";

type EditableTitleProps = {
  value: string;
  /** Shown (dimmed) while `value` is empty. */
  placeholder: string;
  /** Accessible name of the pencil button and of the field, e.g. "Rename the group". */
  label: string;
  /** Applies a new name; resolves with why it was refused, or nothing when it was kept. */
  onCommit: (next: string) => Promise<string | undefined> | string | undefined;
  maxLength?: number;
};

/**
 * A page title with a pencil at its end: the pencil turns it into a field (Enter or leaving it
 * keeps the new name, Escape restores the old one). Rendered inside the page's `<h1>`.
 */
export function EditableTitle({ value, placeholder, label, onCommit, maxLength = 160 }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function start() {
    setDraft(value);
    setError(undefined);
    setEditing(true);
  }

  async function commit() {
    if (saving) return;
    const next = draft.trim();
    if (next === value.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const problem = await onCommit(next);
    setSaving(false);
    if (problem) {
      setError(problem);
      input.current?.focus();
      return;
    }
    setEditing(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setError(undefined);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <span className="flex flex-col gap-1">
        <input
          ref={input}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "editable-title-error" : undefined}
          value={draft}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={saving}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(undefined);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => void commit()}
          className="w-full min-w-0 rounded-lg border border-field-border bg-field px-2 text-[28px] font-semibold tracking-[-0.02em] focus:outline-none focus-visible:ring-2 focus-visible:ring-evaluator/40"
        />
        {error ? (
          <span id="editable-title-error" className="text-sm font-normal tracking-normal text-danger-fg">
            {error}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <span className={cn("break-words", !value && "text-dim")}>{value || placeholder}</span>
      <IconButton size="sm" label={label} icon={<PencilIcon size={16} />} onClick={start} />
    </span>
  );
}
