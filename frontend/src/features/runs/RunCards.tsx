import Link from "next/link";
import type { ReactNode } from "react";
import { useFormat, useT } from "@/lib/i18n";
import { CopyButton, cn, focusRing } from "@/ui";
import { shortId } from "./format";
import { KindBadge } from "./KindBadge";
import { RUN_METRICS, RunResult, RunScore, RunStarted, RunStatus } from "./run-fields";
import { TruncatedText } from "./TruncatedText";
import type { Run } from "./types";

type RunCardsProps = {
  runs: Run[];
  now: number;
  /** Accessible name of the list; defaults to "Runs" (translated). */
  label?: string;
  /** Classes of the list, e.g. to show the cards on small screens only. */
  className?: string;
};

/**
 * Runs as a list of cards, for screens too narrow for the runs table: the same runs and the same
 * figures (`RUN_METRICS`), stacked so nothing scrolls sideways.
 */
export function RunCards({ runs, now, label, className }: RunCardsProps) {
  const t = useT();
  return (
    <ul aria-label={label ?? t("runs.listLabel")} className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {runs.map((run) => (
        <RunCard key={run.id} run={run} now={now} />
      ))}
    </ul>
  );
}

type RunCardProps = { run: Run; now: number };

function RunCard({ run, now }: RunCardProps) {
  const t = useT();
  const format = useFormat();
  const label = shortId(run.id);
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-panel p-4 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/runs/${encodeURIComponent(run.id)}`}
          title={run.scenarioName}
          className={cn("min-w-0 rounded text-sm font-medium hover:underline", focusRing)}
        >
          <span className="block truncate">{run.scenarioName}</span>
        </Link>
        <div className="flex shrink-0 items-start gap-1.5">
          <RunResult run={run} />
          <RunStatus run={run} />
        </div>
      </div>
      <span className="flex min-w-0 items-center gap-1.5 text-muted">
        <TruncatedText text={run.agentName} className="min-w-0" />
        <KindBadge run={run} />
      </span>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Term label={t("runs.persona")}>{run.persona ? <TruncatedText text={run.persona} /> : "—"}</Term>
        <Term label={t("runs.column.started")}>
          <RunStarted run={run} now={now} />
        </Term>
        {RUN_METRICS.map((metric) => (
          <Term key={metric.id} label={t(metric.label)} mono>
            {metric.value(run, now, format)}
          </Term>
        ))}
        <Term label={t("runs.score")}>
          <RunScore run={run} label={label} trackClassName="w-12" />
        </Term>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-xs text-muted" title={run.id}>
            {run.id}
          </span>
          <CopyButton
            text={run.id}
            label={t("runs.copyRunId", { id: label })}
            copiedMessage={t("runs.runIdCopied")}
            iconSize={14}
          />
        </span>
      </div>
    </li>
  );
}

function Term({ label, mono = false, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-dim">{label}</dt>
      <dd className={cn("min-w-0 text-muted", mono && "font-mono text-xs")}>{children}</dd>
    </div>
  );
}
