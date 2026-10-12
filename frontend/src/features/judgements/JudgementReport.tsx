import { Badge, Button, CheckIcon, CopyIcon } from "@/ui";
import {
  PRIORITY_TONES,
  UNOBSERVABLE_REASON_LABELS,
  VERDICT_LABELS,
  VERDICT_TONES,
  cappedExplanation,
  failureTagCountLabel,
  failureTagLabel,
  scoreBand,
  traceStatsLine,
  turnAnchorId,
} from "./format";
import type { CriterionResult, Evidence, JudgeResult, Suggestion } from "./types";

type JudgementReportProps = {
  result: JudgeResult;
  onCopyBrief: () => void;
  copied: boolean;
  onDownloadBrief: () => void;
};

/** A completed judgement: overall score, per-criterion verdicts, suggestions, strengths and the brief. */
export function JudgementReport({ result, onCopyBrief, copied, onDownloadBrief }: JudgementReportProps) {
  return (
    <div className="flex flex-col gap-6">
      <Overview result={result} />
      <FailureTagSummary counts={result.failureTags} />
      <section aria-labelledby="judge-criteria" className="flex flex-col gap-3">
        <h3 id="judge-criteria" className="text-sm font-semibold">
          Criteria
        </h3>
        {result.criteria.length === 0 ? (
          <p className="text-sm text-muted">The scenario has no criteria.</p>
        ) : (
          <ol aria-label="Criteria" className="flex flex-col gap-3">
            {result.criteria.map((criterion) => (
              <CriterionItem key={criterion.criterionId} criterion={criterion} />
            ))}
          </ol>
        )}
      </section>
      <section aria-labelledby="judge-suggestions" className="flex flex-col gap-3">
        <h3 id="judge-suggestions" className="text-sm font-semibold">
          Suggestions
        </h3>
        {result.suggestions.length === 0 ? (
          <p className="text-sm text-muted">No suggestions.</p>
        ) : (
          <ol aria-label="Suggestions" className="flex flex-col gap-3">
            {result.suggestions.map((suggestion, index) => (
              <SuggestionItem key={index} suggestion={suggestion} />
            ))}
          </ol>
        )}
      </section>
      {result.strengths.length > 0 ? (
        <section aria-labelledby="judge-strengths" className="flex flex-col gap-2">
          <h3 id="judge-strengths" className="text-sm font-semibold">
            Strengths
          </h3>
          <ul aria-label="Strengths" className="list-disc pl-5 text-sm">
            {result.strengths.map((strength, index) => (
              <li key={index}>{strength}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="judge-brief" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="judge-brief" className="text-sm font-semibold">
            Brief for a coding agent
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="min-h-9 px-3"
              icon={copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              onClick={onCopyBrief}
            >
              Copy brief
            </Button>
            <Button variant="secondary" className="min-h-9 px-3" onClick={onDownloadBrief}>
              Download .md
            </Button>
          </div>
        </div>
        <span role="status" className="sr-only">
          {copied ? "Brief copied" : ""}
        </span>
        <details className="rounded-lg border border-line">
          <summary className="cursor-pointer px-3 py-2 text-sm text-muted">Preview brief</summary>
          <pre className="max-h-96 overflow-auto px-3 pb-3 font-mono text-xs whitespace-pre-wrap">{result.brief}</pre>
        </details>
      </section>
    </div>
  );
}

function Overview({ result }: { result: JudgeResult }) {
  const score = result.overallScore;
  const band = score === null ? null : scoreBand(score);
  const stats = result.traceStats;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
      <div aria-label="Overall score" role="group" className="flex flex-col items-start gap-1">
        <p className="flex items-baseline gap-1">
          <span className={`font-mono text-4xl font-semibold ${band?.className ?? "text-muted"}`}>
            {score ?? "—"}
          </span>
          <span className="text-sm text-muted">/100</span>
        </p>
        <span className="text-xs text-muted">{band ? band.label : "No criterion was observable"}</span>
        {result.mustFailed ? <Badge tone="danger">Must criterion failed</Badge> : null}
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <p className="text-sm leading-relaxed">{result.summary}</p>
        {stats ? <p className="text-xs text-muted">Traces: {traceStatsLine(stats)}</p> : null}
        {result.traceNote ? (
          <p className="text-xs text-muted">
            {stats ? result.traceNote : `Traces unavailable: ${result.traceNote}`}
          </p>
        ) : null}
        <p className="text-xs text-dim">Judged by {result.model}</p>
      </div>
    </div>
  );
}

/** Judge v2: how many criteria carry each failure tag, most frequent first. Hidden for v1 results. */
function FailureTagSummary({ counts }: { counts: Record<string, number> | undefined }) {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="judge-failure-tags" className="flex flex-col gap-2">
      <h3 id="judge-failure-tags" className="text-sm font-semibold">
        Failure tags
      </h3>
      <ul className="flex flex-wrap gap-2">
        {entries.map(([tag, count]) => (
          <li key={tag}>
            <Badge>{failureTagCountLabel(tag, count)}</Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CriterionItem({ criterion }: { criterion: CriterionResult }) {
  const band = criterion.band ?? null;
  const tags = criterion.failureTags ?? [];
  const reason = criterion.unobservableReason ?? null;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={VERDICT_TONES[criterion.verdict]}>{VERDICT_LABELS[criterion.verdict]}</Badge>
        <span className="font-mono">{criterion.score === null ? "—" : `${criterion.score}/100`}</span>
        {band !== null ? <span className="font-mono">Band {band}/5</span> : null}
        {criterion.capped ? <Badge tone="danger">Capped</Badge> : null}
        <span className="text-muted">weight {criterion.weight}</span>
        <span className="text-muted">{criterion.kind === "must" ? "Must" : "Should"}</span>
        <span className="text-muted">from {criterion.source}</span>
      </div>
      <p className="text-sm font-medium">{criterion.text}</p>
      {criterion.capped ? <p className="text-xs text-danger-fg">{cappedExplanation(tags)}</p> : null}
      {reason ? <p className="text-xs text-muted">{UNOBSERVABLE_REASON_LABELS[reason] ?? reason}</p> : null}
      {tags.length > 0 ? (
        <ul aria-label="Failure tags" className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag}>
              <Badge>{failureTagLabel(tag)}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-sm text-muted">{criterion.rationale}</p>
      {criterion.evidence.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted">Evidence ({criterion.evidence.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {criterion.evidence.map((item, index) => (
              <EvidenceItem key={index} evidence={item} />
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function EvidenceItem({ evidence }: { evidence: Evidence }) {
  return (
    <li className="flex flex-col gap-1 text-xs">
      <span className="flex items-center gap-2 text-muted">
        {evidence.source} <EvidenceRef value={evidence.ref} />
      </span>
      <blockquote className="border-l-2 border-line pl-2 text-sm">{evidence.quote}</blockquote>
    </li>
  );
}

/** A transcript turn ref (A3, C2) links to its row in the transcript; other refs are plain. */
function EvidenceRef({ value }: { value: string }) {
  const anchor = turnAnchorId(value);
  const code = <code className="rounded bg-chip px-1 font-mono">{value}</code>;
  return anchor ? (
    <a href={`#${anchor}`} aria-label={`Go to transcript turn ${value}`}>
      {code}
    </a>
  ) : (
    code
  );
}

function SuggestionItem({ suggestion }: { suggestion: Suggestion }) {
  const priority = suggestion.priority;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={PRIORITY_TONES[priority]}>{`${priority[0].toUpperCase()}${priority.slice(1)} priority`}</Badge>
        <span className="text-muted">{suggestion.area}</span>
      </div>
      <p className="text-sm font-medium">{suggestion.title}</p>
      <p className="text-sm text-muted whitespace-pre-line">{suggestion.detail}</p>
      {suggestion.evidenceRefs.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          Evidence:
          {suggestion.evidenceRefs.map((ref, index) => (
            <EvidenceRef key={index} value={ref} />
          ))}
        </p>
      ) : null}
    </li>
  );
}
