import { Badge, cn } from "@/ui";
import { clock, latency } from "./format";
import { interruptedAt, splitHeard, type Interruption, type TranscriptEntry } from "./transcript";

const WHO = { agent: "Agent", caller: "Evaluator" } as const;

type RunTranscriptProps = {
  entries: TranscriptEntry[];
  /** Live runs announce new lines politely; a finished transcript is static. */
  live?: boolean;
  emptyText: string;
  /** Give each row the id `turn-<ref>` (A3, C2) so the judge's evidence can link to it. */
  anchors?: boolean;
};

/** The conversation, agent lines in blue and evaluator lines in amber, with the evaluator's intent. */
export function RunTranscript({ entries, live = false, emptyText, anchors = false }: RunTranscriptProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted" aria-live={live ? "polite" : undefined}>
        {emptyText}
      </p>
    );
  }
  return (
    <ol aria-label="Transcript" aria-live={live ? "polite" : undefined} aria-relevant="additions" className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li
          key={entry.key}
          id={anchors && entry.ref ? `turn-${entry.ref}` : undefined}
          className={cn(
            "flex flex-col gap-1.5 rounded-lg border-l-2 px-3.5 py-2.5",
            entry.role === "agent" ? "border-agent bg-agent/7" : "border-evaluator bg-evaluator/7",
          )}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-dim">{entry.tMs === null ? "—" : clock(entry.tMs)}</span>
            <span className={cn("font-semibold", entry.role === "agent" ? "text-agent" : "text-evaluator-fg")}>
              {WHO[entry.role]}
            </span>
            {anchors && entry.ref ? <span className="font-mono text-dim">{entry.ref}</span> : null}
            {entry.role === "agent" && entry.latencyMs !== null && entry.latencyMs !== undefined ? (
              <span className="font-mono text-dim" title="Time the agent took to start answering">
                {latency(entry.latencyMs)}
              </span>
            ) : null}
            {entry.interruption ? <Badge tone="danger">{live ? "Caller interrupted" : "Interrupted"}</Badge> : null}
          </div>
          {entry.interruption ? (
            <InterruptedText text={entry.text} interruption={entry.interruption} />
          ) : (
            <p className="text-sm leading-relaxed break-words">{entry.text}</p>
          )}
          {entry.intent ? (
            <p className="text-xs text-muted">
              <span className="font-medium">Evaluator intent:</span> {entry.intent}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

const APPROXIMATE = "Approximately heard (estimated from the audio played)";

/** Whether the agent's server confirmed the correction; nothing when unknown (older runs). */
function Confirmation({ confirmed }: { confirmed?: boolean }) {
  if (confirmed === undefined) return null;
  return (
    <p className="text-xs text-muted">{confirmed ? "Correction confirmed by the agent" : "Correction not confirmed"}</p>
  );
}

/**
 * The heard part, labelled as an estimate, and the unheard rest struck through, with their meaning
 * spelled out for screen readers; then whether the agent confirmed the correction.
 */
function InterruptedText({ text, interruption }: { text: string; interruption: Interruption }) {
  const at = interruptedAt(interruption.audioEndMs);
  const split = splitHeard(text, interruption.heardText);
  if (!split) {
    return (
      <>
        <p className="text-sm leading-relaxed break-words">{text}</p>
        <p className="text-xs text-muted">
          {`≈ Heard before the interruption${interruption.audioEndMs ? ` ${at}` : ""} (estimated from the audio played): “${interruption.heardText.trim()}”`}
        </p>
        <Confirmation confirmed={interruption.confirmed} />
      </>
    );
  }
  const label = `Not heard — the caller interrupted ${at}`;
  return (
    <>
      <p className="text-sm leading-relaxed break-words">
        {split.heard ? (
          <span title={APPROXIMATE}>
            <span aria-hidden="true" className="mr-1 font-mono text-xs text-dim">
              ≈ heard
            </span>
            <span className="sr-only">{`${APPROXIMATE}: `}</span>
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
