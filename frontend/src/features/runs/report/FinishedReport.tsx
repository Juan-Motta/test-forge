"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { JudgementController } from "@/features/judgements/use-judgement-controller";
import { RunCostCard } from "@/features/pricing/RunCostCard";
import { ApiError, errorMessage } from "@/lib/api";
import { useT, type Translator } from "@/lib/i18n";
import { Alert, Tabs, type TabItem } from "@/ui";
import { audioUrl, conversationUrl } from "../api";
import { clock, latency, median } from "../format";
import { useRunLevels, useRunTrace } from "../queries";
import { ChatTranscript } from "../ChatTranscript";
import { runKind } from "../kind";
import { RunTranscript } from "../RunTranscript";
import { entriesFromRows } from "../transcript";
import type { RunDetail } from "../types";
import { ConversationCard } from "./ConversationCard";
import { HandoffCard } from "./HandoffCard";
import { collectIssues, issuePins } from "./issues";
import { JudgeButton, JudgementStatusCard, TranslationNotice } from "./JudgementStatusCard";
import { RecordingCard, type RunMetric } from "./RecordingCard";
import { Scorecard } from "./Scorecard";
import { SuggestionsGrid } from "./SuggestionsGrid";
import { TracePanel } from "./TracePanel";
import { VerdictRow } from "./VerdictRow";

export type ReportTab = "transcript" | "trace" | "suggestions" | "handoff";

/**
 * A finished run's report: verdict, recording (the conversation card for text runs, which have no
 * audio), and the transcript, trace, suggestions and handoff tabs.
 */
export function FinishedReport({ run, controller }: { run: RunDetail; controller: JudgementController }) {
  const t = useT();
  const [tab, setTab] = useState<ReportTab>("transcript");
  // A new object per request, so opening the same turn twice scrolls twice.
  const [turnRequest, setTurnRequest] = useState<{ ref: string } | null>(null);
  const handledRequest = useRef<{ ref: string } | null>(null);
  const text = runKind(run) === "text";
  const levels = useRunLevels(run.id, { enabled: !text });
  const trace = useRunTrace(run.id);

  const judgement = controller.judgement;
  const result = judgement?.status === "completed" ? judgement.result : null;
  const entries = useMemo(() => entriesFromRows(run.transcript ?? []), [run.transcript]);
  const issues = useMemo(
    () => collectIssues(result?.criteria ?? [], entries.flatMap((entry) => (entry.ref ? [entry.ref] : []))),
    [result, entries],
  );
  const issuesByRef = useMemo(() => new Map(issues.map((issue) => [issue.ref, issue])), [issues]);
  const pins = levels.data ? issuePins(t, issues, levels.data) : [];

  // Opening a turn may switch tabs first: scroll once its row is rendered.
  useEffect(() => {
    if (turnRequest === null || turnRequest === handledRequest.current || tab !== "transcript") return;
    handledRequest.current = turnRequest;
    const row = document.getElementById(`turn-${turnRequest.ref}`);
    row?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    row?.focus({ preventScroll: true });
  }, [turnRequest, tab]);

  function goToTurn(ref: string) {
    setTab("transcript");
    setTurnRequest({ ref });
  }

  const durationMs = levels.data?.durationMs || run.summary?.durationMs || 0;
  const levelsProblem =
    levels.error instanceof ApiError && levels.error.status === 409
      ? ({ kind: "unavailable" } as const)
      : levels.isError
        ? ({ kind: "error", message: errorMessage(levels.error) } as const)
        : null;

  const tabs: TabItem<ReportTab>[] = [
    {
      id: "transcript",
      label: t("report.tab.transcript"),
      content: (
        <div className="flex flex-wrap items-start gap-5">
          <section
            aria-labelledby="run-transcript"
            className="flex min-w-0 flex-[999_1_480px] flex-col gap-3 rounded-xl border border-line bg-panel p-5"
          >
            <h2 id="run-transcript" className="text-[15px] font-semibold">
              {t("report.transcript")}
            </h2>
            {text ? (
              <ChatTranscript entries={entries} emptyText={t("report.noMessages")} anchors issues={issuesByRef} />
            ) : (
              <RunTranscript entries={entries} emptyText={t("report.nothingSaid")} anchors issues={issuesByRef} />
            )}
          </section>
          <section
            aria-labelledby="run-scorecard"
            className="flex min-w-0 flex-[1_1_420px] 2xl:flex-[1_1_600px] flex-col gap-3.5 rounded-xl border border-line bg-panel p-5"
          >
            <h2 id="run-scorecard" className="text-[15px] font-semibold">
              {t("report.scorecard")}
            </h2>
            {result ? (
              <Scorecard criteria={result.criteria} onGoToTurn={goToTurn} />
            ) : (
              <p className="text-sm text-muted">{t("report.scorecardPending")}</p>
            )}
          </section>
        </div>
      ),
    },
    {
      id: "trace",
      label: t("report.tab.trace"),
      content: (
        <TracePanel
          trace={trace.data}
          loadError={trace.isError ? errorMessage(trace.error) : null}
          onReload={() => void trace.refetch()}
          durationMs={durationMs}
        />
      ),
    },
    {
      id: "suggestions",
      label: result ? t("report.tab.suggestionsCount", { count: result.suggestions.length }) : t("report.tab.suggestions"),
      content: result ? (
        <SuggestionsGrid suggestions={result.suggestions} onGoToTurn={goToTurn} />
      ) : (
        <p className="text-sm text-muted">{t("report.suggestionsPending")}</p>
      ),
    },
    {
      id: "handoff",
      label: t("report.tab.handoff"),
      content: result ? (
        <HandoffCard
          brief={controller.brief}
          onCopy={controller.copyBrief}
          copied={controller.briefCopied}
          onDownload={controller.downloadBrief}
        />
      ) : (
        <p className="text-sm text-muted">{t("report.handoffPending")}</p>
      ),
    },
  ];

  return (
    <>
      {result ? (
        <>
          {controller.judgeError ? <Alert>{t("judgement.couldNotJudge", { error: controller.judgeError })}</Alert> : null}
          <TranslationNotice controller={controller} />
          <VerdictRow result={result} action={<JudgeButton controller={controller} />} />
        </>
      ) : (
        <JudgementStatusCard controller={controller} />
      )}
      <RunCostCard cost={run.cost} />
      <Warnings warnings={run.summary?.warnings ?? []} />
      {text ? (
        <ConversationCard run={run} />
      ) : (
        <RecordingCard
        conversationSrc={conversationUrl(run.id)}
        conversationDownload={conversationUrl(run.id, { download: true })}
        agentSrc={audioUrl(run.id, "agent")}
        callerSrc={audioUrl(run.id, "caller")}
        levels={levels.data}
        levelsProblem={levelsProblem}
        onReloadLevels={() => void levels.refetch()}
        pins={pins}
        onPin={goToTurn}
        metrics={runMetrics(t, run)}
        />
      )}
      <Tabs label={t("report.sections")} tabs={tabs} value={tab} onChange={setTab} />
      <span role="status" className="sr-only">
        {controller.briefCopied ? t("report.briefCopied") : ""}
      </span>
    </>
  );
}

function runMetrics(t: Translator, run: RunDetail): RunMetric[] {
  const summary = run.summary ?? {};
  const latencies = summary.latenciesMs ?? [];
  return [
    { label: t("report.metric.duration"), value: summary.durationMs === undefined ? "—" : clock(summary.durationMs) },
    { label: t("report.metric.latencyP50"), value: latency(median(latencies)) },
    { label: t("report.metric.slowestReply"), value: latencies.length ? latency(Math.max(...latencies)) : "—" },
    { label: t("report.metric.agentTurns"), value: summary.agentTurns === undefined ? "—" : String(summary.agentTurns) },
    { label: t("report.metric.evaluatorTurns"), value: summary.callerTurns === undefined ? "—" : String(summary.callerTurns) },
  ];
}

function Warnings({ warnings }: { warnings: string[] }) {
  const t = useT();
  if (warnings.length === 0) return null;
  return (
    <Alert tone="info" title={t("report.warnings")}>
      <ul className="flex flex-col gap-1">
        {warnings.map((warning, index) => (
          <li key={index}>{warning}</li>
        ))}
      </ul>
    </Alert>
  );
}
