import type { Translator } from "@/lib/i18n";
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

export function textModeName(t: Translator, mode: TextMode): string {
  return t(`runs.textMode.${mode}`);
}

/** The text agent's mode ("Stream" / "Invoke"), from the summary or the snapshot; null when unknown. */
export function textModeLabel(t: Translator, run: Pick<RunDetail, "summary" | "snapshot">): string | null {
  const mode = run.summary?.textMode ?? run.snapshot?.agent?.textMode;
  return mode ? textModeName(t, mode) : null;
}

