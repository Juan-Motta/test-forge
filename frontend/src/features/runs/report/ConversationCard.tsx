import { useT, type Translator } from "@/lib/i18n";
import { clock, endReasonLabel, latency, median } from "../format";
import { textModeLabel } from "../kind";
import type { RunDetail } from "../types";

export type ConversationMetric = { id?: "tools"; label: string; value: string; hint?: string };

/** A text run's metrics: mode, messages, reply timings, tools and why it ended. */
export function conversationMetrics(t: Translator, run: RunDetail): ConversationMetric[] {
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
    { label: t("report.metric.mode"), value: textModeLabel(t, run) ?? "—" },
    { label: t("report.metric.duration"), value: summary.durationMs === undefined ? "—" : clock(summary.durationMs) },
    { label: t("report.metric.userMessages"), value: count(summary.callerTurns) },
    { label: t("report.metric.agentReplies"), value: count(summary.agentTurns) },
    { label: t("report.metric.firstTextP50"), value: latency(median(firstText)), hint: t("report.metric.firstTextHint") },
    { label: t("report.metric.slowestFirstText"), value: firstText.length ? latency(Math.max(...firstText)) : "—" },
    { label: t("report.metric.fullReplyP50"), value: latency(median(fullReplies)), hint: t("report.metric.fullReplyHint") },
    { id: "tools", label: t("report.metric.toolsUsed"), value: String(tools.length), hint: toolNames.length ? toolNames.join(", ") : undefined },
    { label: t("report.metric.ended"), value: endReasonLabel(t, summary.reason ?? run.endReason, "text") ?? "—" },
  ];
}

/** Replaces the recording card for text runs: there is no audio, only the chat and its timings. */
export function ConversationCard({ run }: { run: RunDetail }) {
  const t = useT();
  const metrics = conversationMetrics(t, run);
  return (
    <section aria-labelledby="run-conversation" className="flex flex-col gap-3.5 rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-col gap-0.5">
        <h2 id="run-conversation" className="text-[15px] font-semibold">
          {t("report.conversation")}
        </h2>
        <p className="text-xs text-dim">{t("report.conversationHint")}</p>
      </div>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex flex-col gap-1 rounded-[10px] bg-raised px-3.5 py-3" title={metric.hint}>
            <dt className="text-xs text-dim">{metric.label}</dt>
            <dd className="font-mono text-sm text-fg">{metric.value}</dd>
            {metric.id === "tools" && metric.hint ? (
              <dd className="truncate text-[11px] text-muted">{metric.hint}</dd>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
