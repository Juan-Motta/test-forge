import { Alert, Badge, Button } from "@/ui";
import type { AgentConnectionTest } from "./types";

/** The last connection test of one agent in this browser session. */
export type ConnectionTestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: AgentConnectionTest; checkedAt: Date }
  | { status: "error"; message: string };

export const IDLE_TEST: ConnectionTestState = { status: "idle" };

/** What the rail dot and the pill say: never color alone. */
export function reachabilityLabel(state: ConnectionTestState): string {
  if (state.status === "running") return "Testing…";
  if (state.status !== "done") return "Not tested";
  if (!state.result.reachable) return "Unreachable";
  return state.result.latencyMs === null ? "Reachable" : `Reachable · ${state.result.latencyMs} ms`;
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
  const tone = reachabilityTone(state);
  return (
    <Badge tone={tone === "neutral" ? "muted" : tone}>
      <ReachabilityDot state={state} className="size-[7px]" />
      {reachabilityLabel(state)}
    </Badge>
  );
}

function checkedTime(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

type ConnectionCheckProps = {
  state: ConnectionTestState;
  onRun: () => void;
};

/** The step-by-step log of the last test, in a terminal-style block, and the button that runs it. */
export function ConnectionCheck({ state, onRun }: ConnectionCheckProps) {
  const running = state.status === "running";
  return (
    <div className="flex flex-col gap-3">
      <div
        role="log"
        aria-label="Connection check"
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
            <span className="text-dim">Last checked {checkedTime(state.checkedAt)} by a connection test</span>
          </>
        ) : (
          <span className="text-dim">
            {running ? "Dialling the agent…" : "No connection test in this session yet."}
          </span>
        )}
      </div>
      {state.status === "error" ? <Alert>Could not run the connection test: {state.message}</Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-dim">
          Tests the saved settings: opens the agent&apos;s WebSocket and closes it once the session is ready; no
          audio is sent. The agent may still start a short session on its side.
        </p>
        <Button variant="secondary" loading={running} onClick={onRun}>
          {running ? "Testing…" : "Run connection test"}
        </Button>
      </div>
    </div>
  );
}
