import { useT, type Translator } from "@/lib/i18n";
import { Badge } from "@/ui";
import { clock, endReasonLabel, latency, median } from "../format";
import { textModeLabel } from "../kind";
import type { RunDetail } from "../types";

/** `meta` describes the conversation (shown as chips by the title); `stat` is a figure. */
export type ConversationMetric = {
  id?: "tools";
  kind: "meta" | "stat";
  label: string;
  value: string;
  hint?: string;
};

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
    { kind: "meta", label: t("report.metric.mode"), value: textModeLabel(t, run) ?? "—" },
    {
      kind: "meta",
      label: t("report.metric.duration"),
      value: summary.durationMs === undefined ? "—" : clock(summary.durationMs),
    },
    { kind: "meta", label: t("report.metric.ended"), value: endReasonLabel(t, summary.reason ?? run.endReason, "text") ?? "—" },
    { kind: "stat", label: t("report.metric.userMessages"), value: count(summary.callerTurns) },
    { kind: "stat", label: t("report.metric.agentReplies"), value: count(summary.agentTurns) },
    {
      kind: "stat",
      label: t("report.metric.firstTextP50"),
      value: latency(median(firstText)),
      hint: t("report.metric.firstTextHint"),
    },
    { kind: "stat", label: t("report.metric.slowestFirstText"), value: firstText.length ? latency(Math.max(...firstText)) : "—" },
    {
      kind: "stat",
      label: t("report.metric.fullReplyP50"),
      value: latency(median(fullReplies)),
      hint: t("report.metric.fullReplyHint"),
    },
    {
      id: "tools",
      kind: "stat",
      label: t("report.metric.toolsUsed"),
      value: String(tools.length),
      hint: toolNames.length ? toolNames.join(", ") : undefined,
    },
  ];
}

/** Replaces the recording card for text runs: there is no audio, only the chat and its timings. */
export function ConversationCard({ run }: { run: RunDetail }) {
  const t = useT();
  const metrics = conversationMetrics(t, run);
  const meta = metrics.filter((metric) => metric.kind === "meta");
  const stats = metrics.filter((metric) => metric.kind === "stat");
  return (
    <section aria-labelledby="run-conversation" className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="run-conversation" className="text-[15px] font-semibold">
            {t("report.conversation")}
          </h2>
          <p className="text-xs text-dim">{t("report.conversationHint")}</p>
        </div>
        {/* What the conversation was (mode, length, how it ended), as chips beside the title. */}
        <dl className="flex flex-wrap items-center gap-2">
          {meta.map((metric) => (
            <div key={metric.label} title={metric.label}>
              <dt className="sr-only">{metric.label}</dt>
              <dd>
                <Badge tone="muted" size="md">
                  {metric.value}
                </Badge>
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {/* The figures fill the row evenly, whatever the width. */}
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
        {stats.map((metric) => (
          <div key={metric.label} className="flex flex-col gap-1.5 rounded-[10px] bg-raised px-4 py-3.5" title={metric.hint}>
            <dt className="text-xs text-dim">{metric.label}</dt>
            <dd className="font-mono text-xl font-semibold tracking-tight text-fg tabular-nums">{metric.value}</dd>
            {metric.id === "tools" && metric.hint ? (
              <dd className="truncate text-[11px] text-muted">{metric.hint}</dd>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
