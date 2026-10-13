import { Badge, Button, KpiTile, ScoreBar, cn } from "@/ui";
import { Figure, Mockup } from "./prose";

/* Small, static pictures of real screens, built from the app's own primitives with sample data. */

const CARD = "flex flex-col gap-1.5 rounded-xl border border-line bg-panel p-4";

/** The report's verdict row: overall score, goals met and the judge summary. */
export function VerdictMockup() {
  return (
    <Figure caption="Example verdict row at the top of a report (sample data).">
      <Mockup label="Example verdict: overall score 69 out of 100, Fair; 3 of 4 goals met; one must criterion failed.">
        <div className="flex flex-wrap gap-3">
          <div className={cn(CARD, "flex-[1_1_160px]")}>
            <span className="text-[13px] text-muted">Overall score</span>
            <p className="flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-[-0.03em] text-evaluator tabular-nums">69</span>
              <span className="text-dim">/100</span>
            </p>
            <ScoreBar score={69} label="Overall score" className="my-1" />
            <span className="text-xs text-muted">Fair</span>
            <span>
              <Badge tone="danger">Must criterion failed</Badge>
            </span>
          </div>
          <div className={cn(CARD, "flex-[1_1_160px]")}>
            <span className="text-[13px] text-muted">Goals met</span>
            <p className="flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-[-0.03em] tabular-nums">3</span>
              <span className="text-dim">/ 4</span>
            </p>
            <span className="text-xs text-muted">Missed: The agent blocks the card</span>
          </div>
          <div className={cn(CARD, "flex-[999_1_260px] gap-2")}>
            <span className="text-[13px] text-muted">Judge summary</span>
            <p className="text-sm leading-6 text-body">
              The agent verified the caller politely but never confirmed the card was blocked before the call ended.
            </p>
            <span className="flex flex-wrap gap-1.5">
              <Badge tone="danger">Incomplete task: 1 criterion</Badge>
            </span>
          </div>
        </div>
      </Mockup>
    </Figure>
  );
}

const CRITERIA = [
  { text: "The agent blocks the card or clearly confirms it is blocked.", score: 50, band: 2, verdict: "Fail", tone: "danger", kind: "Must", weight: 50, source: "transcript", tags: ["Incomplete task"] },
  { text: "The agent verifies identity before acting.", score: 100, band: 5, verdict: "Pass", tone: "success", kind: "Should", weight: 30, source: "transcript", tags: [] },
  { text: "Every agent reply starts in under 2 seconds.", score: 70, band: 3, verdict: "Partial", tone: "evaluator", kind: "Should", weight: 20, source: "timing", tags: ["Slow response"] },
] as const;

/** Three scorecard rows: verdict, band, kind, weight, evidence source and failure tags. */
export function ScorecardMockup() {
  return (
    <Figure caption="Example scorecard: one row per criterion (sample data).">
      <Mockup label="Example scorecard with three criteria: a must criterion that failed with 50, a should criterion that passed with 100, and a timing criterion judged partial with 70.">
        <ol className="flex flex-col gap-3.5">
          {CRITERIA.map((criterion) => (
            <li key={criterion.text} className="flex flex-col gap-2 border-b border-line-soft pb-3.5 last:border-b-0 last:pb-0">
              <div className="flex items-start justify-between gap-2.5">
                <span className="text-[13px] leading-snug font-medium">{criterion.text}</span>
                <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">
                  {criterion.score}
                  <span className="text-xs font-normal text-dim">/100</span>
                </span>
              </div>
              <ScoreBar score={criterion.score} label={criterion.text} />
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Badge tone={criterion.tone}>{criterion.verdict}</Badge>
                <Badge tone="muted" mono>{`B${criterion.band}/5`}</Badge>
                <span className="text-dim">{criterion.kind}</span>
                <span className="text-dim">{`weight ${criterion.weight}`}</span>
                <span className="text-dim">{`from ${criterion.source}`}</span>
                {criterion.tags.map((tag) => (
                  <Badge key={tag} tone="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </Mockup>
    </Figure>
  );
}

/** The launch panel: runs each, in parallel, label, the call count and the wall-time estimate. */
export function LaunchPanelMockup() {
  return (
    <Figure caption="Example launch panel for one scenario: 3 runs, one at a time.">
      <Mockup label="Example launch panel: This scenario selected, Runs each 3, In parallel 1, label after prompt fix, judge automatically checked, 3 calls, about 18 minutes, Launch 3 runs button.">
        <div className="flex max-w-sm flex-col gap-3.5 rounded-xl border border-evaluator-line bg-panel p-4">
          <span className="flex min-h-10 items-center gap-2.5 rounded-lg border border-evaluator bg-selected px-3 text-[13px]">
            <span className="size-3.5 rounded-full border-4 border-evaluator" />
            This scenario
          </span>
          <div className="grid grid-cols-2 gap-3">
            <FakeField label="Runs each" value="3" hint="1–10 per scenario." />
            <FakeField label="In parallel" value="1" hint="1–10 at a time." />
          </div>
          <FakeField label="Label (optional)" value="after prompt fix" />
          <span className="flex items-center gap-2.5 text-[13px] text-body">
            <span className="grid size-4 place-items-center rounded-sm bg-evaluator text-[10px] text-on-evaluator">✓</span>
            Judge automatically when each call ends
          </span>
          <span className="flex justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
            <span>3 calls</span>
            <span>≈ 18 min wall time</span>
          </span>
          <Button tabIndex={-1} className="min-h-11">
            Launch 3 runs
          </Button>
        </div>
      </Mockup>
    </Figure>
  );
}

function FakeField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <span className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className="flex min-h-10 items-center rounded-lg border border-field-line bg-field px-3 font-mono text-sm text-fg">{value}</span>
      {hint ? <span className="text-[11px] text-dim">{hint}</span> : null}
    </span>
  );
}

/** Three of the Overview's key metrics. */
export function KpiMockup() {
  return (
    <Figure caption="Example key metrics on the Overview page (sample data).">
      <Mockup label="Example key metrics: average judge score 82, goal completion 75 percent, agent turn latency p50 1.2 seconds.">
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiTile label="Average judge score" value="82" sub="Last 7 days" />
          <KpiTile label="Goal completion" value="75" unit="%" sub="Must criteria passed" />
          <KpiTile label="Agent turn latency · p50" value="1.2" unit="s" />
        </div>
      </Mockup>
    </Figure>
  );
}
