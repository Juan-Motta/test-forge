import { useRef } from "react";
import { useMediaGuard } from "@/lib/browser/use-media-guard";
import { useT } from "@/lib/i18n";
import { AudioLane, Button, Spinner } from "@/ui";
import { clock } from "../format";
import type { RunLevels } from "../types";
import { timeAxis, type IssuePin } from "./issues";

export type RunMetric = { label: string; value: string };

type RecordingCardProps = {
  /** The whole conversation, both sides mixed on the run timeline. */
  conversationSrc: string;
  /** The same recording, served as an attachment. */
  conversationDownload: string;
  agentSrc: string;
  callerSrc: string;
  levels: RunLevels | undefined;
  /** Why the levels are missing: `unavailable` (409, nothing to draw yet) or an error message. */
  levelsProblem: { kind: "unavailable" } | { kind: "error"; message: string } | null;
  onReloadLevels: () => void;
  pins: IssuePin[];
  /** A pin was clicked: open the transcript at that turn. */
  onPin: (ref: string) => void;
  metrics: RunMetric[];
};

/**
 * Both sides' audio levels aligned on the run timeline, with issue pins at the turns the judge
 * flagged, the run's timing metrics, the conversation as one recording to play or download, and
 * each side's (unaligned) WAV, collapsed.
 */
export function RecordingCard({
  conversationSrc,
  conversationDownload,
  agentSrc,
  callerSrc,
  levels,
  levelsProblem,
  onReloadLevels,
  pins,
  onPin,
  metrics,
}: RecordingCardProps) {
  const t = useT();
  const section = useRef<HTMLElement>(null);
  useMediaGuard(section);
  return (
    <section ref={section} aria-labelledby="call-recording" className="flex flex-col gap-3.5 rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="call-recording" className="text-[15px] font-semibold">
            {t("report.callRecording")}
          </h2>
          <span className="font-mono text-xs text-muted">
            {levels ? t("report.recordingTimeline", { duration: clock(levels.durationMs) }) : t("report.recordingTracks")}
          </span>
        </div>
        <ul aria-label={t("report.runMetrics")} className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {metrics.map((metric) => (
            <li key={metric.label} aria-label={metric.label} className="flex items-baseline gap-1.5">
              <span className="text-dim">{metric.label}</span>
              <span className="font-mono text-fg">{metric.value}</span>
            </li>
          ))}
        </ul>
      </div>
      <Lanes levels={levels} problem={levelsProblem} onReload={onReloadLevels} pins={pins} onPin={onPin} />
      <div className="border-t border-line-soft pt-3.5">
        <Track
          label={t("report.conversation")}
          src={conversationSrc}
          download={conversationDownload}
          downloadLabel={t("report.downloadConversation")}
          tone="text-fg"
        />
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted select-none hover:text-fg">{t("report.separateTracks")}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Track label={t("report.agentTrack")} src={agentSrc} tone="text-agent" />
            <Track label={t("report.evaluatorTrack")} src={callerSrc} tone="text-evaluator" />
          </div>
          <p className="text-dim">{t("report.tracksNotAligned")}</p>
        </div>
      </details>
    </section>
  );
}

function Lanes({
  levels,
  problem,
  onReload,
  pins,
  onPin,
}: {
  levels: RunLevels | undefined;
  problem: RecordingCardProps["levelsProblem"];
  onReload: () => void;
  pins: IssuePin[];
  onPin: (ref: string) => void;
}) {
  const t = useT();
  if (problem?.kind === "unavailable") {
    return <p className="text-sm text-muted">{t("report.lanesPending")}</p>;
  }
  if (problem?.kind === "error") {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>{t("report.levelsFailed", { error: problem.message })}</span>
        <Button variant="secondary" className="min-h-9 px-3" onClick={onReload}>
          {t("common.tryAgain")}
        </Button>
      </div>
    );
  }
  if (!levels) return <Spinner label={t("report.loadingLevels")} />;
  if (levels.durationMs <= 0) return <p className="text-sm text-muted">{t("report.noAudio")}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <AudioLane label={t("common.agent")} tone="agent" values={levels.agent} description={t("report.agentLevels")} />
      <AudioLane
        label={t("common.evaluator")}
        tone="evaluator"
        values={levels.caller}
        description={t("report.evaluatorLevels")}
        pins={pins.map((pin) => ({ n: pin.n, at: pin.at, tone: pin.tone, label: pin.label, onClick: () => onPin(pin.ref) }))}
        axis={timeAxis(levels.durationMs)}
      />
    </div>
  );
}

function Track({
  label,
  src,
  download = src,
  downloadLabel,
  tone,
}: {
  label: string;
  src: string;
  /** URL of the file to save; defaults to `src`. */
  download?: string;
  downloadLabel?: string;
  tone: string;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className={`font-semibold ${tone}`}>{label}</span>
        <a href={download} download aria-label={downloadLabel} className="text-muted hover:text-fg">
          {t("report.downloadWav")}
        </a>
      </div>
      <audio controls preload="none" src={src} aria-label={label} className="w-full" />
    </div>
  );
}
