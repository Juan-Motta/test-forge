import { PRIORITY_TONES } from "@/features/judgements/format";
import type { Suggestion, SuggestionPriority } from "@/features/judgements/types";
import { useT } from "@/lib/i18n";
import { Badge, Pin, type PinTone } from "@/ui";
import { EvidenceRef } from "./EvidenceRef";

const PIN_TONES: Record<SuggestionPriority, PinTone> = { high: "danger", medium: "warn", low: "muted" };

/** The judge's suggestions as numbered cards: title, area, priority, what to change, evidence. */
export function SuggestionsGrid({
  suggestions,
  onGoToTurn,
}: {
  suggestions: readonly Suggestion[];
  onGoToTurn?: (ref: string) => void;
}) {
  const t = useT();
  if (suggestions.length === 0) return <p className="text-sm text-muted">{t("report.noSuggestions")}</p>;
  return (
    <ol aria-label={t("report.tab.suggestions")} className="grid grid-cols-[repeat(auto-fit,minmax(min(480px,100%),1fr))] gap-3.5">
      {suggestions.map((suggestion, index) => (
        <li key={index} className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-[18px]">
          <div className="flex items-start gap-2.5">
            <Pin n={index + 1} tone={PIN_TONES[suggestion.priority]} size="md" className="size-6 text-xs" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h3 className="text-[15px] leading-snug font-semibold">{suggestion.title}</h3>
              <span className="text-xs text-dim">{t(`report.area.${suggestion.area}`)}</span>
            </div>
            <Badge tone={PRIORITY_TONES[suggestion.priority]}>{t(`report.priority.${suggestion.priority}`)}</Badge>
          </div>
          <p className="text-[13px] leading-relaxed whitespace-pre-line text-body-soft">{suggestion.detail}</p>
          {suggestion.evidenceRefs.length > 0 ? (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-dim">
              {t("report.evidence")}
              {suggestion.evidenceRefs.map((ref, refIndex) => (
                <EvidenceRef key={refIndex} value={ref} onGoToTurn={onGoToTurn} />
              ))}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
