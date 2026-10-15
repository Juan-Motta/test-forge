import {
  VERDICT_TONES,
  cappedExplanation,
  failureTagLabel,
  unobservableReasonLabel,
  verdictLabel,
} from "@/features/judgements/format";
import type { CriterionResult } from "@/features/judgements/types";
import { useT } from "@/lib/i18n";
import { Badge, SCORE_TEXT, ScoreBar, cn, scoreTone } from "@/ui";
import { EvidenceRef } from "./EvidenceRef";
import { DISAGREEMENT_SPREAD, bandSpread } from "./issues";

type ScorecardProps = {
  criteria: readonly CriterionResult[];
  onGoToTurn?: (ref: string) => void;
};

/** Each criterion: score and bar, verdict, band and cap, failure tags, why, and the evidence refs. */
export function Scorecard({ criteria, onGoToTurn }: ScorecardProps) {
  const t = useT();
  if (criteria.length === 0) return <p className="text-sm text-muted">{t("report.noCriteria")}</p>;
  return (
    <ol aria-label={t("report.criteria")} className="flex flex-col gap-3.5">
      {criteria.map((criterion) => (
        <CriterionRow key={criterion.criterionId} criterion={criterion} onGoToTurn={onGoToTurn} />
      ))}
    </ol>
  );
}

function CriterionRow({ criterion, onGoToTurn }: { criterion: CriterionResult; onGoToTurn?: (ref: string) => void }) {
  const t = useT();
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
        <Badge tone={VERDICT_TONES[criterion.verdict]}>{verdictLabel(t, criterion.verdict)}</Badge>
        {band !== null ? (
          <Badge tone="muted" mono>
            <span aria-hidden="true">{`B${band}/5`}</span>
            <span className="sr-only">{t("report.band", { band })}</span>
          </Badge>
        ) : null}
        {criterion.capped ? <Badge tone="danger">{t("report.capped")}</Badge> : null}
        <span className="text-dim">{criterion.kind === "must" ? t("report.must") : t("report.should")}</span>
        <span className="text-dim">{t("report.weight", { weight: criterion.weight })}</span>
        <span className="text-dim">{t("report.from", { source: t(`report.source.${criterion.source}`) })}</span>
      </div>
      {criterion.capped ? <p className="text-xs text-danger-fg">{cappedExplanation(t, tags)}</p> : null}
      {reason ? <p className="text-xs text-dim italic">{unobservableReasonLabel(t, reason)}</p> : null}
      {tags.length > 0 ? (
        <ul aria-label={t("report.failureTags")} className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag}>
              <Badge tone="outline">{failureTagLabel(t, tag)}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {criterion.rationale ? <p className="text-xs leading-normal text-muted">{criterion.rationale}</p> : null}
      <SampleBands bands={criterion.sampleBands} />
      {refs.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
          {t("report.evidence")}
          {refs.map((ref) => (
            <EvidenceRef key={ref} value={ref} onGoToTurn={onGoToTurn} />
          ))}
        </p>
      ) : null}
      {criterion.evidence.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-[11px] text-faint">{t("report.quotes", { count: criterion.evidence.length })}</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {criterion.evidence.map((item, index) => (
              <li key={index} className="flex flex-col gap-1 text-xs">
                <span className="text-dim">{`${t(`report.source.${item.source}`)} · ${item.ref}`}</span>
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
  const t = useT();
  if (!bands || bands.length < 2) return null;
  const spread = bandSpread(bands);
  const description = bands
    .map((band) => (band === null ? t("report.sampleNotObservable") : t("report.sampleBand", { band })))
    .join(", ");
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
      <span role="img" aria-label={t("report.judgeSamples", { description })} className="inline-flex items-center gap-1">
        {bands.map((band, index) => (
          <span key={index} title={band === null ? t("judgement.verdict.not_observable") : t("report.band", { band })} className={cn("size-2 rounded-full", DOT_TONE(band))} />
        ))}
      </span>
      <span aria-hidden="true">{t.plural("report.samples", bands.length)}</span>
      {spread !== null && spread >= DISAGREEMENT_SPREAD ? <Badge tone="evaluator">{t("report.judgesDisagreed")}</Badge> : null}
    </div>
  );
}
