import type { AgentKind, RunDetail, RunSnapshot, RunSummary, TextMode } from "./types";

/** The run's agent kind: what the API, the summary or the launch snapshot says; voice otherwise. */
export function runKind(run: {
  agentKind?: AgentKind;
  summary?: RunSummary | null;
  snapshot?: Pick<RunSnapshot, "agent"> | null;
}): AgentKind {
  return run.agentKind === "text" || run.summary?.kind === "text" || run.snapshot?.agent?.kind === "text"
    ? "text"
    : "voice";
}

export const TEXT_MODE_LABELS: Record<TextMode, string> = { stream: "Stream", invoke: "Invoke" };

/** The text agent's mode ("Stream" / "Invoke"), from the summary or the snapshot; null when unknown. */
export function textModeLabel(run: Pick<RunDetail, "summary" | "snapshot">): string | null {
  const mode = run.summary?.textMode ?? run.snapshot?.agent?.textMode;
  return mode ? TEXT_MODE_LABELS[mode] : null;
}

