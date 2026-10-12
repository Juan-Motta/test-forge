"use client";

import { useState } from "react";
import { Alert, Button, EmptyState, RunsIcon, Spinner, cn } from "@/ui";
import { latency } from "../format";
import type { RunTrace } from "../types";
import { traceSummaryLine, waterfallRows, type WaterfallRow } from "./waterfall";

type TracePanelProps = {
  trace: RunTrace | undefined;
  loadError: string | null;
  onReload: () => void;
  /** The run's duration: the waterfall's timeline. */
  durationMs: number;
};

const TYPE_CHIP: Record<string, string> = {
  llm: "bg-llm/16 text-llm-fg",
  tool: "bg-agent/14 text-agent-fg",
};
const TYPE_BAR: Record<string, string> = { llm: "bg-llm", tool: "bg-agent" };

/** The agent's Langfuse observations as a waterfall over the run, warnings and errors in red. */
export function TracePanel({ trace, loadError, onReload, durationMs }: TracePanelProps) {
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  if (loadError) {
    return (
      <Alert title="Could not load the trace">
        <span className="block">{loadError}</span>
        <Button variant="secondary" className="mt-3" onClick={onReload}>
          Try again
        </Button>
      </Alert>
    );
  }
  if (!trace) return <Spinner label="Loading trace" />;
  if (!trace.available || trace.observations.length === 0) {
    return (
      <EmptyState
        icon={<RunsIcon size={22} />}
        title="No Langfuse trace for this run"
        description={trace.note ?? "No observations were saved for this run."}
      />
    );
  }

  const rows = waterfallRows(trace.observations, durationMs);
  const flagged = rows.filter((row) => row.flagged).length;
  const shown = onlyFlagged ? rows.filter((row) => row.flagged) : rows;

  return (
    <section aria-labelledby="trace-title" className="flex flex-col gap-3.5 rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="trace-title" className="text-[15px] font-semibold">
            Langfuse trace
          </h2>
          <span className="text-xs text-dim">{traceSummaryLine(trace)}</span>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-[13px] text-body-soft">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(event) => setOnlyFlagged(event.target.checked)}
            className="size-[18px] accent-evaluator"
          />
          {`Only flagged (${flagged})`}
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No observation was flagged as a warning or an error.</p>
      ) : (
        <div className="overflow-x-auto">
          <ul aria-label="Trace observations" className="flex min-w-[760px] flex-col gap-0.5">
            {shown.map((row, index) => (
              <WaterfallItem key={row.id ?? index} row={row} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function WaterfallItem({ row }: { row: WaterfallRow }) {
  const type = row.type.toLowerCase();
  return (
    <li
      data-flagged={row.flagged || undefined}
      className={cn("flex items-center gap-3 rounded-lg px-2.5 py-2", row.flagged && "bg-danger/7")}
    >
      <span className="flex w-[300px] min-w-0 shrink-0 items-center gap-2" style={{ paddingLeft: `${row.depth * 16}px` }}>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.05em] uppercase",
            TYPE_CHIP[type] ?? "bg-tag text-muted",
          )}
        >
          {type}
        </span>
        <span className="truncate font-mono text-xs" title={row.name ?? undefined}>
          {row.name ?? "(unnamed)"}
        </span>
      </span>
      <span aria-hidden="true" className="relative h-3.5 flex-1 rounded-[3px] bg-raised">
        <span
          className={cn("absolute inset-y-0 rounded-[3px]", row.flagged ? "bg-danger" : (TYPE_BAR[type] ?? "bg-line-strong"))}
          style={{ left: `${row.left}%`, width: `${row.width}%` }}
        />
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-xs text-muted">
        {row.durationMs === null ? "—" : latency(row.durationMs)}
      </span>
      <span
        className={cn("w-[170px] shrink-0 truncate text-xs", row.flagged ? "text-danger-fg" : "text-dim")}
        title={row.note || undefined}
      >
        {row.note}
      </span>
    </li>
  );
}
