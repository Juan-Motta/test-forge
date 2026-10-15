import { useT } from "@/lib/i18n";
import { Badge, Pin, cn } from "@/ui";
import { clock, latency } from "./format";
import type { Issue } from "./report/issues";
import { interruptedAt, splitHeard, type Interruption, type TranscriptEntry } from "./transcript";

const WHO = { agent: "common.agent", caller: "common.evaluator" } as const;
/** An agent reply slower than this reads as a slow turn. */
const SLOW_REPLY_MS = 2000;

type RunTranscriptProps = {
  entries: TranscriptEntry[];
  /** Live runs announce new lines politely; a finished transcript is static. */
  live?: boolean;
  emptyText: string;
  /** Give each row the id `turn-<ref>` (A3, C2) so the judge's evidence can link to it. */
  anchors?: boolean;
  /** Issues by turn ref: the row gets a red border, its pin and the criteria it failed. */
  issues?: ReadonlyMap<string, Issue>;
};

/**
 * The conversation with a time gutter, agent lines in blue and evaluator lines in amber, with the
 * evaluator's intent; turns the judge flagged are outlined in red with their issue pin.
 */
export function RunTranscript({ entries, live = false, emptyText, anchors = false, issues }: RunTranscriptProps) {
  const t = useT();
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted" aria-live={live ? "polite" : undefined}>
        {emptyText}
      </p>
    );
  }
  return (
    <ol aria-label={t("report.transcript")} aria-live={live ? "polite" : undefined} aria-relevant="additions" className="flex flex-col gap-2.5">
      {entries.map((entry) => {
        const issue = entry.ref ? issues?.get(entry.ref) : undefined;
        const slow = entry.role === "agent" && (entry.latencyMs ?? 0) > SLOW_REPLY_MS;
        return (
          <li
            key={entry.key}
            id={anchors && entry.ref ? `turn-${entry.ref}` : undefined}
            tabIndex={anchors && entry.ref ? -1 : undefined}
            data-issue={issue ? issue.n : undefined}
            className="flex scroll-mt-4 items-start gap-3 rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-evaluator"
          >
            <span className="w-11 shrink-0 pt-[3px] font-mono text-[11px] text-faint">
              {entry.tMs === null ? "—" : clock(entry.tMs)}
            </span>
            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-1.5 rounded-[10px] border px-3 py-2.5",
                entry.role === "agent" ? "bg-agent/7" : "bg-evaluator/7",
                issue ? "border-danger/45" : "border-transparent",
              )}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("font-semibold", entry.role === "agent" ? "text-agent" : "text-evaluator")}>
                  {t(WHO[entry.role])}
                </span>
                {anchors && entry.ref ? <span className="font-mono text-[11px] text-faint">{entry.ref}</span> : null}
                {entry.role === "agent" && entry.latencyMs !== null && entry.latencyMs !== undefined ? (
                  <span
                    className={cn("font-mono text-[11px]", slow ? "text-danger-fg" : "text-faint")}
                    title={t("transcript.latencyHint")}
                  >
                    {latency(entry.latencyMs)}
                  </span>
                ) : null}
                {entry.interruption ? <Badge tone="danger">{live ? t("transcript.callerInterrupted") : t("transcript.interrupted")}</Badge> : null}
              </div>
              {entry.interruption ? (
                <InterruptedText text={entry.text} interruption={entry.interruption} />
              ) : (
                <p className="text-sm leading-normal break-words text-body">{entry.text}</p>
              )}
              {entry.intent ? (
                <p className="text-xs text-muted">
                  <span className="font-medium">{t("transcript.intent")}</span> {entry.intent}
                </p>
              ) : null}
              {issue ? (
                <p className="inline-flex items-center gap-1.5 text-xs text-danger-fg">
                  <Pin n={issue.n} tone={issue.tone} size="sm" />
                  <span className="sr-only">{`${t("ui.issue", { n: issue.n })}: `}</span>
                  {issue.criteria.join("; ")}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Whether the agent's server confirmed the correction; nothing when unknown (older runs). */
function Confirmation({ confirmed }: { confirmed?: boolean }) {
  const t = useT();
  if (confirmed === undefined) return null;
  return <p className="text-xs text-muted">{confirmed ? t("transcript.confirmed") : t("transcript.notConfirmed")}</p>;
}

/**
 * The heard part, labelled as an estimate, and the unheard rest struck through, with their meaning
 * spelled out for screen readers; then whether the agent confirmed the correction.
 */
function InterruptedText({ text, interruption }: { text: string; interruption: Interruption }) {
  const t = useT();
  const approximate = t("transcript.approximate");
  const at = interruptedAt(t, interruption.audioEndMs);
  const split = splitHeard(text, interruption.heardText);
  if (!split) {
    return (
      <>
        <p className="text-sm leading-relaxed break-words">{text}</p>
        <p className="text-xs text-muted">
          {interruption.audioEndMs
            ? t("transcript.heardBeforeAt", { at, text: interruption.heardText.trim() })
            : t("transcript.heardBefore", { text: interruption.heardText.trim() })}
        </p>
        <Confirmation confirmed={interruption.confirmed} />
      </>
    );
  }
  const label = t("transcript.notHeard", { at });
  return (
    <>
      <p className="text-sm leading-relaxed break-words">
        {split.heard ? (
          <span title={approximate}>
            <span aria-hidden="true" className="mr-1 font-mono text-xs text-dim">
              {t("transcript.heardShort")}
            </span>
            <span className="sr-only">{`${approximate}: `}</span>
            <span>{split.heard}</span>
          </span>
        ) : null}
        {split.heard && split.unheard ? " " : null}
        {split.unheard ? (
          <span title={label} className="text-dim line-through">
            <span className="sr-only">{`${label}: `}</span>
            {split.unheard}
          </span>
        ) : null}
      </p>
      <Confirmation confirmed={interruption.confirmed} />
    </>
  );
}
