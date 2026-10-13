import Link from "next/link";
import { clock, runDurationMs } from "@/features/runs/format";
import { runKind } from "@/features/runs/kind";
import type { Run } from "@/features/runs/types";
import { LiveDot, VolumeIcon, Waveform, buttonClasses, cn, focusRing } from "@/ui";
import { placeholderWave } from "./format";

type LiveNowCardProps = {
  /** Up to 3 running runs (calls and text conversations); undefined while loading or when they could not be loaded. */
  runs: Run[] | undefined;
  /** Every running run; null when unknown. */
  total: number | null;
  error: string | null;
  now: number;
};

/** Runs in progress right now, each with a way to listen in (calls) or watch (text conversations). */
export function LiveNowCard({ runs, total, error, now }: LiveNowCardProps) {
  const headingId = "live-now";
  let content;
  if (error) {
    content = <p className="text-sm text-danger-fg">{`Could not load live runs: ${error}`}</p>;
  } else if (runs === undefined) {
    content = <p className="text-sm text-muted">Loading live runs…</p>;
  } else if (runs.length === 0) {
    content = <p className="text-sm text-muted">Nothing running right now.</p>;
  } else {
    content = (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3.5">
        {runs.map((run) => (
          <LiveSessionCard key={run.id} run={run} now={now} />
        ))}
      </div>
    );
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <LiveDot />
          <h2 id={headingId} className="text-base font-semibold">
            Live now
          </h2>
          <span className="text-[13px] text-muted">{`${total ?? "—"} ${total === 1 ? "session" : "sessions"}`}</span>
        </div>
        <Link
          href="/live"
          aria-label="Open live monitor"
          className={cn("inline-flex min-h-11 items-center rounded text-[13px] font-medium text-agent", focusRing)}
        >
          Open live monitor →
        </Link>
      </div>
      {content}
    </section>
  );
}

function LiveSessionCard({ run, now }: { run: Run; now: number }) {
  const elapsed = runDurationMs(run, now);
  const text = runKind(run) === "text";
  const wave = text ? null : placeholderWave(run.id);
  const titleId = `live-session-${run.id}`;
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-[10px] border border-line-soft bg-raised p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span id={titleId} className="truncate text-sm font-semibold">
            {run.scenarioName}
          </span>
          <span className="truncate text-xs text-muted">{[run.persona, run.agentName].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="shrink-0 rounded-md bg-chip px-2 py-0.5 font-mono text-xs">
          {elapsed === null ? "—" : clock(elapsed)}
        </span>
      </div>
      {wave ? <Waveform values={wave.values} tones={wave.tones} height={40} /> : null}
      <Link
        href={`/live?batchId=${encodeURIComponent(run.batchId)}`}
        className={buttonClasses("secondary", "min-h-10 text-[13px]")}
      >
        {text ? (
          "Watch"
        ) : (
          <>
            <VolumeIcon size={16} />
            Listen in
          </>
        )}
      </Link>
    </article>
  );
}
