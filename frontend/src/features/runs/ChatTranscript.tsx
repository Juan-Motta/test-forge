import { useT } from "@/lib/i18n";
import { Badge, Pin, cn } from "@/ui";
import { clock, latency } from "./format";
import type { Issue } from "./report/issues";
import type { TranscriptEntry } from "./transcript";
import { AgentText } from "./AgentText";

const WHO = { agent: "common.agent", caller: "transcript.user" } as const;
/** A reply whose first text took longer than this reads as slow. */
const SLOW_FIRST_TEXT_MS = 2000;

type ChatTranscriptProps = {
  entries: TranscriptEntry[];
  /** Live runs announce new messages politely; a finished conversation is static. */
  live?: boolean;
  emptyText: string;
  /** Give each message the id `turn-<ref>` (A3, C2) so the judge's evidence can link to it. */
  anchors?: boolean;
  /** Issues by turn ref: the message gets a red border, its pin and the criteria it failed. */
  issues?: ReadonlyMap<string, Issue>;
  /** Live: the message the evaluator decided to send and has not sent yet. */
  pending?: { say: string; tMs: number | null } | null;
};

/**
 * A text run as a chat: the evaluator's messages (the simulated user) on the right, the agent's
 * replies on the left with how long the first text and the full reply took, the tools it ran and
 * whether the reply broke off.
 */
export function ChatTranscript({ entries, live = false, emptyText, anchors = false, issues, pending }: ChatTranscriptProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2.5">
      {entries.length === 0 ? (
        <p className="text-sm text-muted" aria-live={live ? "polite" : undefined}>
          {emptyText}
        </p>
      ) : (
        <ol
          aria-label={t("transcript.conversation")}
          aria-live={live ? "polite" : undefined}
          aria-relevant="additions"
          className="flex flex-col gap-2.5"
        >
          {entries.map((entry) => {
            const issue = entry.ref ? issues?.get(entry.ref) : undefined;
            const user = entry.role === "caller";
            return (
              <li
                key={entry.key}
                id={anchors && entry.ref ? `turn-${entry.ref}` : undefined}
                tabIndex={anchors && entry.ref ? -1 : undefined}
                data-issue={issue ? issue.n : undefined}
                className={cn(
                  "flex scroll-mt-4 rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-evaluator",
                  user ? "justify-end pl-8" : "justify-start pr-8",
                )}
              >
                <div
                  className={cn(
                    "flex max-w-[640px] min-w-0 flex-col gap-1.5 rounded-[14px] border px-3.5 py-2.5",
                    user ? "rounded-br-[4px] bg-evaluator/7" : "rounded-bl-[4px] bg-agent/7",
                    issue ? "border-danger/45" : entry.incomplete ? "border-dashed border-danger/45" : "border-transparent",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={cn("font-semibold", user ? "text-evaluator" : "text-agent")}>{t(WHO[entry.role])}</span>
                    {anchors && entry.ref ? <span className="font-mono text-[11px] text-faint">{entry.ref}</span> : null}
                    <span className="font-mono text-[11px] text-faint">{entry.tMs === null ? "—" : clock(entry.tMs)}</span>
                    {entry.streaming ? <Badge tone="agent">{t("transcript.writing")}</Badge> : null}
                    {entry.incomplete ? <Badge tone="danger">{t("transcript.brokeOff")}</Badge> : null}
                  </div>
                  {/* The agent's replies follow the Markdown preference; the evaluator's text stays as typed. */}
                  {entry.role === "agent" ? (
                    <AgentText text={entry.text} />
                  ) : (
                    <p className="text-sm leading-normal break-words whitespace-pre-wrap text-body">{entry.text}</p>
                  )}
                  {entry.role === "agent" ? <ReplyTiming entry={entry} /> : null}
                  {entry.tools && entry.tools.length > 0 ? (
                    <ul aria-label={t("report.metric.toolsUsed")} className="flex flex-wrap gap-1.5">
                      {entry.tools.map((tool, index) => (
                        <li key={`${tool.name}-${index}`}>
                          <Badge tone={tool.success === false ? "danger" : "outline"} mono>
                            {tool.name}
                            {tool.success === false ? <span className="sr-only">{` ${t("transcript.toolFailed")}`}</span> : null}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {entry.intent ? (
                    <p className="text-xs text-muted">
                      <span className="font-medium">{t("transcript.intent")}</span> {entry.intent}
                    </p>
                  ) : null}
                  {issue ? (
                    <p className="inline-flex items-center gap-1.5 text-xs text-danger-fg">
                      <Pin n={issue.n} tone={issue.tone} size="sm" />
                      <span className="sr-only">{`${t("ui.issue", { n: issue.n })}: `}</span>
                      {issue.criteria.join("; ")}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {pending ? (
        <p
          role="status"
          aria-label={t("transcript.aboutToSendLabel")}
          className="ml-8 self-end rounded-[14px] border border-dashed border-evaluator/40 bg-evaluator/7 px-3.5 py-2.5 text-sm text-muted italic"
        >
          {t("transcript.aboutToSend", { text: pending.say })}
        </p>
      ) : null}
    </div>
  );
}

/** "First text in 800 ms · full reply in 1.5 s", the first part red when slow. */
function ReplyTiming({ entry }: { entry: TranscriptEntry }) {
  const t = useT();
  const firstText = entry.firstTextMs ?? (entry.incomplete ? null : entry.latencyMs) ?? null;
  const parts: { text: string; slow?: boolean }[] = [];
  if (firstText !== null) parts.push({ text: t("transcript.firstText", { time: latency(firstText) }), slow: firstText > SLOW_FIRST_TEXT_MS });
  if (entry.fullReplyMs !== null && entry.fullReplyMs !== undefined) {
    const time = latency(entry.fullReplyMs);
    parts.push({ text: parts.length ? t("transcript.fullReplyAfter", { time }) : t("transcript.fullReply", { time }) });
  }
  if (parts.length === 0) return null;
  return (
    <p className="font-mono text-[11px] text-faint">
      {parts.map((part, index) => (
        <span key={part.text} className={cn(part.slow && "text-danger-fg")}>
          {index > 0 ? " · " : ""}
          {part.text}
        </span>
      ))}
    </p>
  );
}
