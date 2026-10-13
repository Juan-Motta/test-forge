import { clock, endReasonLabel, latency, median } from "../format";
import { textModeLabel } from "../kind";
import type { RunDetail } from "../types";

export type ConversationMetric = { label: string; value: string; hint?: string };

/** A text run's metrics: mode, messages, reply timings, tools and why it ended. */
export function conversationMetrics(run: RunDetail): ConversationMetric[] {
  const summary = run.summary ?? {};
  const firstText = summary.latenciesMs ?? [];
  const turns = summary.turns ?? [];
  const fullReplies = turns.flatMap((turn) =>
    typeof turn.endMs === "number" && typeof turn.requestMs === "number" ? [turn.endMs - turn.requestMs] : [],
  );
  const tools = turns.flatMap((turn) => turn.tools ?? []);
  const toolNames = [...new Set(tools)];
  const count = (value: number | undefined) => (value === undefined ? "—" : String(value));
  return [
    { label: "Mode", value: textModeLabel(run) ?? "—" },
    { label: "Duration", value: summary.durationMs === undefined ? "—" : clock(summary.durationMs) },
    { label: "User messages", value: count(summary.callerTurns) },
    { label: "Agent replies", value: count(summary.agentTurns) },
    { label: "First text p50", value: latency(median(firstText)), hint: "From the user message to the first text" },
    { label: "Slowest first text", value: firstText.length ? latency(Math.max(...firstText)) : "—" },
    { label: "Full reply p50", value: latency(median(fullReplies)), hint: "From the user message to the end of the reply" },
    { label: "Tools used", value: String(tools.length), hint: toolNames.length ? toolNames.join(", ") : undefined },
    { label: "Ended", value: endReasonLabel(summary.reason ?? run.endReason, "text") ?? "—" },
  ];
}

/** Replaces the recording card for text runs: there is no audio, only the chat and its timings. */
export function ConversationCard({ run }: { run: RunDetail }) {
  const metrics = conversationMetrics(run);
  return (
    <section aria-labelledby="run-conversation" className="flex flex-col gap-3.5 rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-col gap-0.5">
        <h2 id="run-conversation" className="text-[15px] font-semibold">
          Conversation
        </h2>
        <p className="text-xs text-dim">A text agent: the evaluator chatted with it as the user. Times run from each user message.</p>
      </div>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex flex-col gap-1 rounded-[10px] bg-raised px-3.5 py-3" title={metric.hint}>
            <dt className="text-xs text-dim">{metric.label}</dt>
            <dd className="font-mono text-sm text-fg">{metric.value}</dd>
            {metric.label === "Tools used" && metric.hint ? (
              <dd className="truncate text-[11px] text-muted">{metric.hint}</dd>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
