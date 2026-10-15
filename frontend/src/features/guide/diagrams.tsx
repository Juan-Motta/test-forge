import type { ReactNode } from "react";
import { Badge, cn, type BadgeTone } from "@/ui";
import { Figure } from "./prose";

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

const FLOW: FlowStep[] = [
  {
    title: "Scenario",
    tone: "neutral",
    detail: "You describe one kind of call: who the caller is, what they want, what they know and how the call is scored.",
  },
  {
    title: "Batch",
    tone: "neutral",
    detail: "Launching one or more scenarios creates a batch: one run per scenario and repetition, queued in order.",
  },
  {
    title: "Run: a real call",
    tone: "evaluator",
    detail: "The evaluator phones your agent over its WebSocket and plays the caller until the call ends.",
    extra: <CallPill />,
  },
  {
    title: "Artifacts",
    tone: "agent",
    detail: "Everything is recorded: both voices as audio, the transcript, per-turn timings and an event log.",
  },
  {
    title: "Judge",
    tone: "llm",
    detail: "A judge model reads the transcript, the timings and (when linked) the agent's Langfuse traces, and scores every criterion.",
  },
  {
    title: "Report",
    tone: "success",
    detail: "You get a score, a verdict per criterion, suggestions and a brief you can hand to a coding agent.",
  },
];

function CallPill() {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <Badge tone="evaluator">Evaluator (caller)</Badge>
      <span aria-hidden="true" className="font-mono text-dim">
        ⇄
      </span>
      <span className="sr-only">talks with</span>
      <Badge tone="agent">Your agent</Badge>
      <span className="text-dim">over WebSocket audio</span>
    </span>
  );
}

/** Scenario → batch → run → artifacts → judge → report, as a vertical pipeline. */
export function FlowDiagram() {
  return (
    <Figure caption="From scenario to report: what happens after you press Launch.">
      <ol className="flex flex-col">
        {FLOW.map((step, index) => (
          <li key={step.title} className="relative flex gap-3.5 pb-5 last:pb-0">
            {index < FLOW.length - 1 ? (
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

const TERMINAL: { status: string; tone: BadgeTone; meaning: string }[] = [
  { status: "Completed", tone: "success", meaning: "The call ended normally: a hang-up, the agent closing, or a time or silence limit." },
  { status: "Failed", tone: "danger", meaning: "Something broke, such as the agent being unreachable. The run shows a short reason." },
  { status: "Cancelled", tone: "muted", meaning: "Someone stopped it (Cancel run or Stop all)." },
  { status: "Interrupted", tone: "evaluator", meaning: "The server stopped or restarted while the call was in progress." },
];

const ACTIVE: { status: string; meaning: string }[] = [
  { status: "Queued", meaning: "Waiting for a free slot" },
  { status: "Connecting", meaning: "Dialling the agent" },
  { status: "Running", meaning: "The call is in progress" },
];

/** queued → connecting → running → one of four final states. */
export function RunLifecycleDiagram() {
  return (
    <Figure caption="Run lifecycle: every run moves left to right and ends in exactly one final state.">
      <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        {ACTIVE.map((step, index) => (
          <li key={step.status} className="flex flex-col gap-2 sm:flex-1 sm:flex-row sm:items-center">
            <div className="flex flex-1 flex-col gap-1 rounded-lg border border-line-strong bg-raised px-3 py-2.5">
              <span className="text-sm font-semibold text-fg">{step.status}</span>
              <span className="text-xs text-muted">{step.meaning}</span>
            </div>
            <span aria-hidden="true" className="self-center font-mono text-dim">
              <span className="sm:hidden">↓</span>
              <span className="hidden sm:inline">{index < ACTIVE.length - 1 ? "→" : "↘"}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs font-medium tracking-[0.06em] text-dim uppercase">Ends as one of</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {TERMINAL.map((item) => (
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
export function BargeInIllustration() {
  const cut = 56; // % of the agent's reply that played before the caller cut in.
  return (
    <Figure caption="Anatomy of a barge-in: the caller cuts the agent off 1.5 s into its second reply; only the first part was heard.">
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Lane label="Agent" tone="agent">
          <span className="absolute inset-y-0 left-0 rounded-l-md bg-agent/70" style={{ width: `${cut}%` }} />
          <span
            className="absolute inset-y-0 right-0 rounded-r-md border border-dashed border-agent/50 bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_srgb,var(--ve-agent)_18%,transparent)_6px_9px)]"
            style={{ left: `${cut}%` }}
          />
        </Lane>
        <Lane label="Caller" tone="evaluator">
          <span className="absolute inset-y-0 rounded-md bg-evaluator/75" style={{ left: `${cut + 2}%`, width: "34%" }} />
        </Lane>
        <div className="relative ml-16 h-6">
          <span className="absolute top-0 h-6 w-px bg-evaluator" style={{ left: `${cut}%` }} />
          <span
            className="absolute top-1 -translate-x-full pr-1.5 text-[11px] whitespace-nowrap text-evaluator-fg"
            style={{ left: `${cut}%` }}
          >
            cut at 1.5 s
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <Bubble who="Agent" tone="agent">
          <span className="text-fg">I can block it right away. First, can you confirm</span>{" "}
          <span className="text-dim line-through decoration-dim/60">the last four digits of the card?</span>
        </Bubble>
        <Bubble who="Caller" tone="evaluator">
          Sorry, it ends in 4821. Please block it now.
        </Bubble>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-agent/70" />
          Heard by the caller
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm border border-dashed border-agent/60" />
          Generated but never heard (struck through)
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
export function SamplesDiagram() {
  const samples = [4, 2, 4];
  return (
    <Figure caption="Three judge samples on the same evidence; the criterion keeps the median band (here 4, so 90 points and a pass).">
      <div className="flex flex-wrap items-center gap-3" aria-hidden="true">
        {samples.map((band, index) => (
          <span key={index} className="flex flex-col items-center gap-1 rounded-lg border border-line bg-field px-3 py-2">
            <span className="text-[11px] text-dim">{`Sample ${index + 1}`}</span>
            <span className={cn("font-mono text-lg font-semibold", band >= 4 ? "text-success" : band === 3 ? "text-evaluator" : "text-danger")}>
              {`B${band}`}
            </span>
          </span>
        ))}
        <span className="font-mono text-dim">→</span>
        <span className="flex flex-col items-center gap-1 rounded-lg border border-success/40 bg-success/10 px-3 py-2">
          <span className="text-[11px] text-dim">Median</span>
          <span className="font-mono text-lg font-semibold text-success">B4 · 90</span>
        </span>
        <Badge tone="evaluator">Judges disagreed</Badge>
      </div>
      <p className="text-sm leading-6 text-body">
        Bands 2 and 4 are two apart, so the report flags the criterion with <strong className="text-fg">Judges disagreed</strong>: a
        hint that its wording may be ambiguous.
      </p>
    </Figure>
  );
}
