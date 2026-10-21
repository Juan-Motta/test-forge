"use client";

import { useT } from "@/lib/i18n";
import { cn } from "@/ui";
import { VALUE_SOURCES, type ValueSource } from "./value-source";

/** Fixed values, flow inputs and connection variables gray, secrets amber, saved values teal, AI values purple. */
const STYLES: Record<ValueSource, string> = {
  fixed: "bg-chip text-muted",
  input: "bg-chip text-muted",
  variable: "bg-chip text-muted",
  secret: "bg-evaluator/15 text-evaluator-fg",
  saved: "bg-success/15 text-success-fg",
  generated: "bg-llm/15 text-llm-fg",
};

/** Where a value comes from; hovering it says what that means. */
export function SourceChip({ source }: { source: ValueSource }) {
  const t = useT();
  return (
    <span
      title={t(`flows.source.${source}.hint`)}
      className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", STYLES[source])}
    >
      {t(`flows.source.${source}`)}
    </span>
  );
}

/** Every value source on one line, as a key to the chips of the steps. */
export function SourceLegend() {
  const t = useT();
  return (
    <ul aria-label={t("flows.legend")} className="flex flex-wrap items-center gap-1.5">
      {VALUE_SOURCES.map((source) => (
        <li key={source}>
          <SourceChip source={source} />
        </li>
      ))}
    </ul>
  );
}
