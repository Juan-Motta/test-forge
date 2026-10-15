import type { MouseEvent } from "react";
import { turnAnchorId } from "@/features/judgements/format";
import { useT } from "@/lib/i18n";
import { focusRing } from "@/ui";

type EvidenceRefProps = {
  value: string;
  /** Opens the transcript at that turn (it may live in another tab); the link still works without it. */
  onGoToTurn?: (ref: string) => void;
};

/** A transcript turn ref (A3, C2) links to its row in the transcript; other refs (T2, R1) are plain. */
export function EvidenceRef({ value, onGoToTurn }: EvidenceRefProps) {
  const t = useT();
  const anchor = turnAnchorId(value);
  const code = <code className="rounded bg-chip px-1 font-mono text-[11px]">{value}</code>;
  if (!anchor) return code;
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!onGoToTurn) return;
    event.preventDefault();
    onGoToTurn(value.trim());
  }
  return (
    <a href={`#${anchor}`} aria-label={t("report.goToTurn", { ref: value })} onClick={onClick} className={`rounded ${focusRing}`}>
      {code}
    </a>
  );
}
