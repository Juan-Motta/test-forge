import type { ReactNode } from "react";
import { Badge, cn, type BadgeTone } from "@/ui";
import type { Locale } from "@/lib/i18n/config";
import { Figure } from "./prose";
import { fill, guideText, type GuideText } from "./text";

/* Diagrams drawn with HTML and the design tokens (blue = agent under test, amber = evaluator),
   so they reflow on a phone instead of shrinking into unreadable pictures. */

type FlowStep = { title: string; detail: ReactNode; tone: "evaluator" | "agent" | "neutral" | "llm" | "success"; extra?: ReactNode };

const DOT: Record<FlowStep["tone"], string> = {
  evaluator: "border-evaluator bg-evaluator/15 text-evaluator-fg",
  agent: "border-agent bg-agent/15 text-agent-fg",
  neutral: "border-line-strong bg-raised text-muted",
  llm: "border-llm bg-llm/15 text-llm-fg",
  success: "border-success bg-success/15 text-success-fg",
};

function flowSteps(text: GuideText["flow"]): FlowStep[] {
  return [
    { title: text.scenarioTitle, tone: "neutral", detail: text.scenarioDetail },
    { title: text.batchTitle, tone: "neutral", detail: text.batchDetail },
    { title: text.runTitle, tone: "evaluator", detail: text.runDetail, extra: <CallPill text={text} /> },
    { title: text.artifactsTitle, tone: "agent", detail: text.artifactsDetail },
    { title: text.judgeTitle, tone: "llm", detail: text.judgeDetail },
    { title: text.reportTitle, tone: "success", detail: text.reportDetail },
  ];
}

function CallPill({ text }: { text: GuideText["flow"] }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <Badge tone="evaluator">{text.evaluator}</Badge>
      <span aria-hidden="true" className="font-mono text-dim">
        ⇄
      </span>
      <span className="sr-only">{text.talksWith}</span>
      <Badge tone="agent">{text.agent}</Badge>
      <span className="text-dim">{text.channel}</span>
    </span>
  );
}

/** Scenario → batch → run → artifacts → judge → report, as a vertical pipeline. */
export function FlowDiagram({ locale }: { locale: Locale }) {
  const text = guideText(locale).flow;
  const steps = flowSteps(text);
  return (
    <Figure caption={text.caption}>
      <ol className="flex flex-col">
        {steps.map((step, index) => (
          <li key={step.title} className="relative flex gap-3.5 pb-5 last:pb-0">
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className="absolute top-8 bottom-0 left-[15px] w-px bg-line-strong" />
            ) : null}
            <span
              aria-hidden="true"
              className={cn("z-10 grid size-8 shrink-0 place-items-center rounded-full border font-mono text-xs font-semibold", DOT[step.tone])}
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1 pt-1">
              <span className="text-[15px] font-semibold text-fg">{step.title}</span>
              <span className="text-sm leading-6 text-body">{step.detail}</span>
              {step.extra}
            </div>
          </li>
        ))}
      </ol>
    </Figure>
  );
}

/** queued → connecting → running → one of four final states. */
export function RunLifecycleDiagram({ locale }: { locale: Locale }) {
  const text = guideText(locale).lifecycle;
  const active = [
    { status: text.queued, meaning: text.queuedMeaning },
    { status: text.connecting, meaning: text.connectingMeaning },
    { status: text.running, meaning: text.runningMeaning },
  ];
  const terminal: { status: string; tone: BadgeTone; meaning: string }[] = [
    { status: text.completed, tone: "success", meaning: text.completedMeaning },
    { status: text.failed, tone: "danger", meaning: text.failedMeaning },
    { status: text.cancelled, tone: "muted", meaning: text.cancelledMeaning },
    { status: text.interrupted, tone: "evaluator", meaning: text.interruptedMeaning },
  ];
  return (
    <Figure caption={text.caption}>
      <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        {active.map((step, index) => (
          <li key={step.status} className="flex flex-col gap-2 sm:flex-1 sm:flex-row sm:items-center">
            <div className="flex flex-1 flex-col gap-1 rounded-lg border border-line-strong bg-raised px-3 py-2.5">
              <span className="text-sm font-semibold text-fg">{step.status}</span>
              <span className="text-xs text-muted">{step.meaning}</span>
            </div>
            <span aria-hidden="true" className="self-center font-mono text-dim">
              <span className="sm:hidden">↓</span>
              <span className="hidden sm:inline">{index < active.length - 1 ? "→" : "↘"}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs font-medium tracking-[0.06em] text-dim uppercase">{text.endsAs}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {terminal.map((item) => (
          <li key={item.status} className="flex flex-col gap-1.5 rounded-lg border border-line bg-field px-3 py-2.5">
            <span>
              <Badge tone={item.tone}>{item.status}</Badge>
            </span>
            <span className="text-xs leading-5 text-body-soft">{item.meaning}</span>
          </li>
        ))}
      </ul>
    </Figure>
  );
}

/** Two lanes on one timeline: the agent's reply is cut where the caller barges in. */
export function BargeInIllustration({ locale }: { locale: Locale }) {
  const text = guideText(locale).bargeIn;
  const cut = 56; // % of the agent's reply that played before the caller cut in.
  return (
    <Figure caption={text.caption}>
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Lane label={text.agent} tone="agent">
          <span className="absolute inset-y-0 left-0 rounded-l-md bg-agent/70" style={{ width: `${cut}%` }} />
          <span
            className="absolute inset-y-0 right-0 rounded-r-md border border-dashed border-agent/50 bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_srgb,var(--ve-agent)_18%,transparent)_6px_9px)]"
            style={{ left: `${cut}%` }}
          />
        </Lane>
        <Lane label={text.caller} tone="evaluator">
          <span className="absolute inset-y-0 rounded-md bg-evaluator/75" style={{ left: `${cut + 2}%`, width: "34%" }} />
        </Lane>
        <div className="relative ml-16 h-6">
          <span className="absolute top-0 h-6 w-px bg-evaluator" style={{ left: `${cut}%` }} />
          <span
            className="absolute top-1 -translate-x-full pr-1.5 text-[11px] whitespace-nowrap text-evaluator-fg"
            style={{ left: `${cut}%` }}
          >
            {text.cut}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <Bubble who={text.agent} tone="agent">
          <span className="text-fg">{text.agentHeard}</span>{" "}
          <span className="text-dim line-through decoration-dim/60">{text.agentUnheard}</span>
        </Bubble>
        <Bubble who={text.caller} tone="evaluator">
          {text.callerReply}
        </Bubble>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-agent/70" />
          {text.heard}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm border border-dashed border-agent/60" />
          {text.unheard}
        </li>
      </ul>
    </Figure>
  );
}

function Lane({ label, tone, children }: { label: string; tone: "agent" | "evaluator"; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn("w-13 shrink-0 text-xs font-medium", tone === "agent" ? "text-agent-fg" : "text-evaluator-fg")}>{label}</span>
      <div className="relative h-5 flex-1 rounded-md bg-field">{children}</div>
    </div>
  );
}

function Bubble({ who, tone, children }: { who: string; tone: "agent" | "evaluator"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex max-w-[34rem] flex-col gap-1 rounded-lg border px-3 py-2 text-sm leading-6",
        tone === "agent" ? "border-agent/30 bg-agent/6" : "self-end border-evaluator/30 bg-evaluator/6",
      )}
    >
      <span className={cn("text-xs font-semibold", tone === "agent" ? "text-agent-fg" : "text-evaluator-fg")}>{who}</span>
      <span className="text-body">{children}</span>
    </div>
  );
}

/** How one criterion is judged three times and reduced to a single band. */
export function SamplesDiagram({ locale }: { locale: Locale }) {
  const text = guideText(locale).samples;
  const samples = [4, 2, 4];
  return (
    <Figure caption={text.caption}>
      <div className="flex flex-wrap items-center gap-3" aria-hidden="true">
        {samples.map((band, index) => (
          <span key={index} className="flex flex-col items-center gap-1 rounded-lg border border-line bg-field px-3 py-2">
            <span className="text-[11px] text-dim">{fill(text.sample, { n: index + 1 })}</span>
            <span className={cn("font-mono text-lg font-semibold", band >= 4 ? "text-success-fg" : band === 3 ? "text-evaluator-fg" : "text-danger-fg")}>
              {`B${band}`}
            </span>
          </span>
        ))}
        <span className="font-mono text-dim">→</span>
        <span className="flex flex-col items-center gap-1 rounded-lg border border-success/40 bg-success/10 px-3 py-2">
          <span className="text-[11px] text-dim">{text.median}</span>
          <span className="font-mono text-lg font-semibold text-success-fg">B4 · 90</span>
        </span>
        <Badge tone="evaluator">{text.disagreed}</Badge>
      </div>
      <p className="text-sm leading-6 text-body">
        {text.explanationBefore} <strong className="text-fg">{text.disagreed}</strong>
        {text.explanationAfter}
      </p>
    </Figure>
  );
}
