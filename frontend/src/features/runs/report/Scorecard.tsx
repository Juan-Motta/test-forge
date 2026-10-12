import {
  UNOBSERVABLE_REASON_LABELS,
  VERDICT_LABELS,
  VERDICT_TONES,
  cappedExplanation,
  failureTagLabel,
} from "@/features/judgements/format";
import type { CriterionResult } from "@/features/judgements/types";
import { Badge, SCORE_TEXT, ScoreBar, cn, scoreTone } from "@/ui";
import { EvidenceRef } from "./EvidenceRef";
import { DISAGREEMENT_SPREAD, bandSpread } from "./issues";

type ScorecardProps = {
  criteria: readonly CriterionResult[];
  onGoToTurn?: (ref: string) => void;
};

/** Each criterion: score and bar, verdict, band and cap, failure tags, why, and the evidence refs. */
export function Scorecard({ criteria, onGoToTurn }: ScorecardProps) {
  if (criteria.length === 0) return <p className="text-sm text-muted">The scenario has no criteria.</p>;
  return (
    <ol aria-label="Criteria" className="flex flex-col gap-3.5">
      {criteria.map((criterion) => (
        <CriterionRow key={criterion.criterionId} criterion={criterion} onGoToTurn={onGoToTurn} />
      ))}
    </ol>
  );
}

function CriterionRow({ criterion, onGoToTurn }: { criterion: CriterionResult; onGoToTurn?: (ref: string) => void }) {
  const { score } = criterion;
  const band = criterion.band ?? null;
  const tags = criterion.failureTags ?? [];
  const reason = criterion.unobservableReason ?? null;
  const refs = [...new Set(criterion.evidence.map((item) => item.ref.trim()))];
  return (
    <li className="flex flex-col gap-2 border-b border-line-soft pb-3.5 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-2.5">
        <span className="text-[13px] leading-snug font-medium">{criterion.text}</span>
        <span
          className={cn("text-[15px] font-semibold whitespace-nowrap tabular-nums", score === null ? "text-dim" : SCORE_TEXT[scoreTone(score)])}
        >
          {score ?? "—"}
          <span className="text-xs font-normal text-dim">/100</span>
        </span>
      </div>
      <ScoreBar score={score} label={criterion.text} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge tone={VERDICT_TONES[criterion.verdict]}>{VERDICT_LABELS[criterion.verdict]}</Badge>
        {band !== null ? (
          <Badge tone="muted" mono>
            <span aria-hidden="true">{`B${band}/5`}</span>
            <span className="sr-only">{`Band ${band}/5`}</span>
          </Badge>
        ) : null}
        {criterion.capped ? <Badge tone="danger">Capped</Badge> : null}
        <span className="text-dim">{criterion.kind === "must" ? "Must" : "Should"}</span>
        <span className="text-dim">{`weight ${criterion.weight}`}</span>
        <span className="text-dim">{`from ${criterion.source}`}</span>
      </div>
      {criterion.capped ? <p className="text-xs text-danger-fg">{cappedExplanation(tags)}</p> : null}
      {reason ? <p className="text-xs text-dim italic">{UNOBSERVABLE_REASON_LABELS[reason] ?? reason}</p> : null}
      {tags.length > 0 ? (
        <ul aria-label="Failure tags" className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag}>
              <Badge tone="outline">{failureTagLabel(tag)}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {criterion.rationale ? <p className="text-xs leading-normal text-muted">{criterion.rationale}</p> : null}
      <SampleBands bands={criterion.sampleBands} />
      {refs.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
          Evidence:
          {refs.map((ref) => (
            <EvidenceRef key={ref} value={ref} onGoToTurn={onGoToTurn} />
          ))}
        </p>
      ) : null}
      {criterion.evidence.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-[11px] text-faint">{`Quotes (${criterion.evidence.length})`}</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {criterion.evidence.map((item, index) => (
              <li key={index} className="flex flex-col gap-1 text-xs">
                <span className="text-dim">{`${item.source} · ${item.ref}`}</span>
                <blockquote className="border-l-2 border-line pl-2 text-sm text-body">{item.quote}</blockquote>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

const DOT_TONE = (band: number | null) =>
  band === null ? "border border-field-line" : band >= 4 ? "bg-success" : band === 3 ? "bg-evaluator" : "bg-danger";

/** Each judge sample's band as a dot; "Judges disagreed" when two bands are two or more apart. */
function SampleBands({ bands }: { bands: CriterionResult["sampleBands"] }) {
  if (!bands || bands.length < 2) return null;
  const spread = bandSpread(bands);
  const description = bands.map((band) => (band === null ? "not observable" : `band ${band}`)).join(", ");
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
      <span role="img" aria-label={`Judge samples: ${description}`} className="inline-flex items-center gap-1">
        {bands.map((band, index) => (
          <span key={index} title={band === null ? "Not observable" : `Band ${band}/5`} className={cn("size-2 rounded-full", DOT_TONE(band))} />
        ))}
      </span>
      <span aria-hidden="true">{`${bands.length} samples`}</span>
      {spread !== null && spread >= DISAGREEMENT_SPREAD ? <Badge tone="evaluator">Judges disagreed</Badge> : null}
    </div>
  );
}
