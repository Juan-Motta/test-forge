import { useT, type Translator } from "@/lib/i18n";
import { Alert, Badge, Button } from "@/ui";
import type { AgentConnectionTest, AgentKind } from "./types";

/** The last connection test of one agent in this browser session. */
export type ConnectionTestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: AgentConnectionTest; checkedAt: Date }
  | { status: "error"; message: string };

export const IDLE_TEST: ConnectionTestState = { status: "idle" };

/** What the rail dot and the pill say: never color alone. */
export function reachabilityLabel(t: Translator, state: ConnectionTestState): string {
  if (state.status === "running") return t("check.testing");
  if (state.status !== "done") return t("check.notTested");
  if (!state.result.reachable) return t("check.unreachable");
  return state.result.latencyMs === null
    ? t("check.reachable")
    : t("check.reachableMs", { ms: state.result.latencyMs });
}

/** `success`, `danger` or neutral, for the dot in the rail and the pill. */
export function reachabilityTone(state: ConnectionTestState): "success" | "danger" | "neutral" {
  if (state.status !== "done") return "neutral";
  return state.result.reachable ? "success" : "danger";
}

const DOTS = { success: "bg-success", danger: "bg-danger", neutral: "bg-dim" } as const;

export function ReachabilityDot({ state, className }: { state: ConnectionTestState; className?: string }) {
  return <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOTS[reachabilityTone(state)]} ${className ?? ""}`} />;
}

/** The pill in the realtime connection card's header. */
export function ReachabilityPill({ state }: { state: ConnectionTestState }) {
  const t = useT();
  const tone = reachabilityTone(state);
  return (
    <Badge tone={tone === "neutral" ? "muted" : tone}>
      <ReachabilityDot state={state} className="size-[7px]" />
      {reachabilityLabel(t, state)}
    </Badge>
  );
}

function checkedTime(locale: string, at: Date): string {
  return at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

type ConnectionCheckProps = {
  state: ConnectionTestState;
  onRun: () => void;
  /** What the test does differs: a voice agent's socket is opened; a text agent gets a message. */
  kind?: AgentKind;
};



/** The step-by-step log of the last test, in a terminal-style block, and the button that runs it. */
export function ConnectionCheck({ state, onRun, kind = "voice" }: ConnectionCheckProps) {
  const t = useT();
  const running = state.status === "running";
  return (
    <div className="flex flex-col gap-3">
      <div
        role="log"
        aria-label={t("check.label")}
        className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-code p-3.5 font-mono text-xs leading-relaxed"
      >
        {state.status === "done" ? (
          <>
            {state.result.log.map((line, index) => (
              <span
                key={`${index}-${line.message}`}
                data-ok={line.ok}
                className={line.ok ? "text-success-fg" : "text-danger-fg"}
              >
                {line.ok ? "✓" : "✗"} {line.message}
              </span>
            ))}
            <span className="text-dim">{t("check.lastChecked", { time: checkedTime(t.locale, state.checkedAt) })}</span>
          </>
        ) : (
          <span className="text-dim">
            {running ? (kind === "text" ? t("check.messaging") : t("check.dialling")) : t("check.none")}
          </span>
        )}
      </div>
      {state.status === "error" ? <Alert>{t("check.failed", { error: state.message })}</Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-dim">{t(`check.what.${kind}`)}</p>
        <Button variant="secondary" loading={running} onClick={onRun}>
          {running ? t("check.testing") : t("check.run")}
        </Button>
      </div>
    </div>
  );
}
