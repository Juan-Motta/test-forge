"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { cn, focusRing } from "./cn";
import { rovingIndex } from "./roving";

export type TabItem<T extends string = string> = {
  id: T;
  label: string;
  /** Count shown after the label (e.g. open suggestions). */
  badge?: number | string;
  content: ReactNode;
};

type TabsProps<T extends string> = {
  /** Accessible name of the tablist. */
  label: string;
  tabs: readonly TabItem<T>[];
  /** Controlled selection; omit to let the component keep it (starting at `defaultValue` or the first tab). */
  value?: T;
  defaultValue?: T;
  onChange?: (id: T) => void;
  className?: string;
  panelClassName?: string;
};

/**
 * WAI-ARIA tabs with automatic activation: arrows (wrapping), Home and End move and select. Only the
 * selected panel renders its content; the others stay as empty, hidden panels so every tab's
 * aria-controls resolves.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  defaultValue,
  onChange,
  className,
  panelClassName,
}: TabsProps<T>) {
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [own, setOwn] = useState<T | undefined>(defaultValue);
  const current = value ?? own ?? tabs[0]?.id;

  function select(id: T) {
    if (value === undefined) setOwn(id);
    onChange?.(id);
  }

  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = (id: string) => `${baseId}-panel-${id}`;

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-line">
        {tabs.map((tab, index) => {
          const selected = tab.id === current;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                refs.current[index] = node;
              }}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.id)}
              onKeyDown={(event) => {
                const next = rovingIndex(event, index, tabs.length);
                if (next === null) return;
                event.preventDefault();
                refs.current[next]?.focus();
                select(tabs[next].id);
              }}
              className={cn(
                "-mb-px inline-flex min-h-11 cursor-pointer items-center gap-2 border-b-2 px-3.5 py-3 text-sm transition-colors",
                focusRing,
                selected ? "border-evaluator font-semibold text-fg" : "border-transparent font-medium text-muted hover:text-fg",
              )}
            >
              {tab.label}
              {tab.badge !== undefined ? (
                <span className="rounded-full bg-chip px-1.5 py-px font-mono text-[11px] text-muted">{tab.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => {
        const selected = tab.id === current;
        return (
          <div
            key={tab.id}
            id={panelId(tab.id)}
            role="tabpanel"
            aria-labelledby={tabId(tab.id)}
            hidden={!selected}
            tabIndex={0}
            className={cn("outline-none", panelClassName)}
          >
            {selected ? tab.content : null}
          </div>
        );
      })}
    </div>
  );
}
