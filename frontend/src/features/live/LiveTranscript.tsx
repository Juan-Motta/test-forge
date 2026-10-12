import { clock, latency } from "@/features/runs/format";
import { interruptedAt, splitHeard, type Interruption, type TranscriptEntry } from "@/features/runs/transcript";
import { Badge, cn } from "@/ui";
import type { PendingLine } from "./live-state";
import { SLOW_TURN_MS } from "./live-view";

const WHO = { agent: "Agent", caller: "Evaluator" } as const;
const GUTTER = "w-11 shrink-0 pt-[3px] font-mono text-[11px] text-faint";
const APPROXIMATE = "Approximately heard (estimated from the audio played)";

type LiveTranscriptProps = {
  entries: TranscriptEntry[];
  /** What the evaluator decided to say and has not started saying: shown dimmed, after the lines. */
  pending: PendingLine | null;
};

/** The call so far: time gutter, agent bubbles in blue and evaluator bubbles in amber. */
export function LiveTranscript({ entries, pending }: LiveTranscriptProps) {
  return (
    <div className="flex flex-col gap-2.5">
      {entries.length === 0 ? (
        <p className="text-sm text-muted" aria-live="polite">
          Nothing said yet.
        </p>
      ) : (
        <ol aria-label="Transcript" aria-live="polite" aria-relevant="additions" className="flex flex-col gap-2.5">
          {entries.map((entry) => (
            <li key={entry.key} className="flex items-start gap-3">
              <span className={GUTTER}>{entry.tMs === null ? "—" : clock(entry.tMs)}</span>
              <div
                className={cn(
                  "flex min-w-0 flex-1 flex-col gap-1 rounded-[10px] px-3 py-2.5",
                  entry.role === "agent" ? "bg-agent/7" : "bg-evaluator/7",
                )}
              >
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={cn("font-semibold", entry.role === "agent" ? "text-agent" : "text-evaluator")}>
                    {WHO[entry.role]}
                  </span>
                  {entry.role === "agent" ? <Latency ms={entry.latencyMs} /> : null}
                  {entry.interruption ? <Badge tone="danger">Caller interrupted</Badge> : null}
                </span>
                {entry.interruption ? (
                  <InterruptedText text={entry.text} interruption={entry.interruption} />
                ) : (
                  <p className="text-sm leading-normal break-words">{entry.text}</p>
                )}
                {entry.intent ? (
                  <p className="text-xs text-muted">
                    <span className="font-medium">Evaluator intent:</span> {entry.intent}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {pending ? (
        <div className="flex items-start gap-3">
          <span className={GUTTER}>{pending.tMs === null ? "—" : clock(pending.tMs)}</span>
          <p
            role="status"
            aria-label="Evaluator is about to say"
            className="min-w-0 flex-1 rounded-[10px] border border-dashed border-evaluator/40 bg-evaluator/7 px-3 py-2.5 text-sm text-muted italic"
          >
            {`About to say… “${pending.say}”`}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Latency({ ms }: { ms: number | null | undefined }) {
  if (ms === null || ms === undefined) return null;
  const slow = ms > SLOW_TURN_MS;
  return (
    <span className={cn("font-mono text-[11px]", slow ? "text-danger-fg" : "text-faint")} title="Time the agent took to start answering">
      {slow ? `${latency(ms)} · slow` : latency(ms)}
    </span>
  );
}

/** Whether the agent's server confirmed the correction; nothing when not reported yet. */
function Confirmation({ confirmed }: { confirmed?: boolean }) {
  if (confirmed === undefined) return null;
  return <p className="text-xs text-muted">{confirmed ? "Correction confirmed by the agent" : "Correction not confirmed"}</p>;
}

/** The heard part (an estimate) and the unheard rest struck through, spelled out for screen readers. */
function InterruptedText({ text, interruption }: { text: string; interruption: Interruption }) {
  const at = interruptedAt(interruption.audioEndMs);
  const split = splitHeard(text, interruption.heardText);
  if (!split) {
    return (
      <>
        <p className="text-sm leading-normal break-words">{text}</p>
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
      <p className="text-sm leading-normal break-words">
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
