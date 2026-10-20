import { Badge, Button, CheckIcon, CloseIcon, CopyIcon, EyeIcon, KpiTile, ScoreBar, cn, type BadgeTone } from "@/ui";
import type { Locale } from "@/lib/i18n/config";
import { Figure, Mockup } from "./prose";
import { fill, guideText } from "./text";

/* Small, static pictures of real screens, built from the app's own primitives with sample data. */

const CARD = "flex flex-col gap-1.5 rounded-xl border border-line bg-panel p-4";

/** The report's verdict row: overall score, goals met and the judge summary. */
export function VerdictMockup({ locale }: { locale: Locale }) {
  const text = guideText(locale).verdictMockup;
  return (
    <Figure caption={text.caption}>
      <Mockup label={text.label}>
        <div className="flex flex-wrap gap-3">
          <div className={cn(CARD, "flex-[1_1_160px]")}>
            <span className="text-[13px] text-muted">{text.overallScore}</span>
            <p className="flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-[-0.03em] text-evaluator-fg tabular-nums">69</span>
              <span className="text-dim">/100</span>
            </p>
            <ScoreBar score={69} label={text.overallScore} className="my-1" />
            <span className="text-xs text-muted">{text.fair}</span>
            <span>
              <Badge tone="danger">{text.mustFailed}</Badge>
            </span>
          </div>
          <div className={cn(CARD, "flex-[1_1_160px]")}>
            <span className="text-[13px] text-muted">{text.goalsMet}</span>
            <p className="flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-[-0.03em] tabular-nums">3</span>
              <span className="text-dim">/ 4</span>
            </p>
            <span className="text-xs text-muted">{text.missed}</span>
          </div>
          <div className={cn(CARD, "flex-[999_1_260px] gap-2")}>
            <span className="text-[13px] text-muted">{text.judgeSummary}</span>
            <p className="text-sm leading-6 text-body">{text.summary}</p>
            <span className="flex flex-wrap gap-1.5">
              <Badge tone="danger">{text.incomplete}</Badge>
            </span>
          </div>
        </div>
      </Mockup>
    </Figure>
  );
}

/** Three scorecard rows: verdict, band, kind, weight, evidence source and failure tags. */
export function ScorecardMockup({ locale }: { locale: Locale }) {
  const text = guideText(locale).scorecardMockup;
  const criteria: {
    text: string;
    score: number;
    band: number;
    verdict: string;
    tone: BadgeTone;
    kind: string;
    weight: number;
    source: string;
    tags: string[];
  }[] = [
    { text: text.blockCard, score: 50, band: 2, verdict: text.fail, tone: "danger", kind: text.must, weight: 50, source: text.transcript, tags: [text.incompleteTask] },
    { text: text.verifyIdentity, score: 100, band: 5, verdict: text.pass, tone: "success", kind: text.should, weight: 30, source: text.transcript, tags: [] },
    { text: text.fastReplies, score: 70, band: 3, verdict: text.partial, tone: "evaluator", kind: text.should, weight: 20, source: text.timing, tags: [text.slowResponse] },
  ];
  return (
    <Figure caption={text.caption}>
      <Mockup label={text.label}>
        <ol className="flex flex-col gap-3.5">
          {criteria.map((criterion) => (
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
                <span className="text-dim">{fill(text.weight, { weight: criterion.weight })}</span>
                <span className="text-dim">{fill(text.from, { source: criterion.source })}</span>
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
export function LaunchPanelMockup({ locale }: { locale: Locale }) {
  const text = guideText(locale).launchMockup;
  return (
    <Figure caption={text.caption}>
      <Mockup label={text.label}>
        <div className="flex max-w-sm flex-col gap-3.5 rounded-xl border border-evaluator-line bg-panel p-4">
          <span className="flex min-h-10 items-center gap-2.5 rounded-lg border border-evaluator bg-selected px-3 text-[13px]">
            <span className="size-3.5 rounded-full border-4 border-evaluator" />
            {text.thisScenario}
          </span>
          <div className="grid grid-cols-2 gap-3">
            <FakeField label={text.runsEach} value="3" hint={text.runsEachHint} />
            <FakeField label={text.inParallel} value="1" hint={text.inParallelHint} />
          </div>
          <FakeField label={text.labelField} value={text.labelValue} />
          <span className="flex items-center gap-2.5 text-[13px] text-body">
            <span className="grid size-4 place-items-center rounded-sm bg-evaluator text-[10px] text-on-evaluator">✓</span>
            {text.autoJudge}
          </span>
          <span className="flex justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
            <span>{text.calls}</span>
            <span>{text.wallTime}</span>
          </span>
          <Button tabIndex={-1} className="min-h-11">
            {text.launch}
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
export function KpiMockup({ locale }: { locale: Locale }) {
  const text = guideText(locale).kpiMockup;
  return (
    <Figure caption={text.caption}>
      <Mockup label={text.label}>
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiTile label={text.averageScore} value="82" sub={text.lastWeek} />
          <KpiTile label={text.goalCompletion} value="75" unit="%" sub={text.mustPassed} />
          <KpiTile label={text.latency} value="1.2" unit="s" />
        </div>
      </Mockup>
    </Figure>
  );
}

/** A flow run: header, the steps strip, and step 1's request with a masked secret, the eye and Copy cURL. */
export function ApiFlowRunMockup({ locale }: { locale: Locale }) {
  const text = guideText(locale).apiFlowMockup;
  const steps = [
    { method: "POST", tone: "success" as const, path: "/auth/token", facts: "200 · 120 ms", ok: true },
    { method: "GET", tone: "agent" as const, path: "/products?q=shoes", facts: "500 · 80 ms", ok: false },
  ];
  return (
    <Figure caption={text.caption}>
      <Mockup label={text.label}>
        <div className="flex flex-col gap-3">
          <div className={cn(CARD, "flex-row flex-wrap items-center justify-between gap-2")}>
            <span className="text-sm font-semibold">{text.runOf}</span>
            <Badge tone="danger">{text.failed}</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {steps.map((step, index) => (
              <div key={step.path} className={cn(CARD, "gap-1 p-3", index === 0 && "border-evaluator")}>
                <span className="flex items-center gap-1.5">
                  {step.ok ? <CheckIcon size={14} className="text-success-fg" /> : <CloseIcon size={14} className="text-danger-fg" />}
                  <Badge tone={step.tone} mono className="text-[10px] font-semibold">
                    {step.method}
                  </Badge>
                </span>
                <span className="font-mono text-xs text-fg">{step.path}</span>
                <span className="font-mono text-[11px] text-dim">{step.facts}</span>
              </div>
            ))}
          </div>
          <div className={cn(CARD, "gap-2.5")}>
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{text.request}</span>
              <span className="flex gap-2">
                <Button variant="ghost" tabIndex={-1} icon={<EyeIcon size={14} />}>
                  {text.showSecrets}
                </Button>
                <Button variant="secondary" tabIndex={-1} icon={<CopyIcon size={14} />}>
                  {text.copyCurl}
                </Button>
              </span>
            </span>
            <span className="font-mono text-xs text-fg">POST https://shop.example.com/v1/auth/token</span>
            <span className="font-mono text-xs">
              <span className="text-muted">X-Key </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-field-line bg-field px-1.5">
                <span className="text-fg">apiKey</span> <span className="text-dim">••••7890</span>
              </span>
            </span>
          </div>
        </div>
      </Mockup>
    </Figure>
  );
}
