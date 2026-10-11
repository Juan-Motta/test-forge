import { cn } from "@/ui";
import { clock, latency } from "./format";
import type { TranscriptEntry } from "./transcript";

const WHO = { agent: "Agent", caller: "Evaluator" } as const;

type RunTranscriptProps = {
  entries: TranscriptEntry[];
  /** Live runs announce new lines politely; a finished transcript is static. */
  live?: boolean;
  emptyText: string;
};

/** The conversation, agent lines in blue and evaluator lines in amber, with the evaluator's intent. */
export function RunTranscript({ entries, live = false, emptyText }: RunTranscriptProps) {
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
            {entry.role === "agent" && entry.latencyMs !== null && entry.latencyMs !== undefined ? (
              <span className="font-mono text-dim" title="Time the agent took to start answering">
                {latency(entry.latencyMs)}
              </span>
            ) : null}
          </div>
          <p className="text-sm leading-relaxed break-words">{entry.text}</p>
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
