import { Badge } from "@/ui";
import { runKind } from "./kind";
import type { Run } from "./types";

/** "Voice" or "Text": which kind of agent the run talked to. */
export function KindBadge({ run }: { run: Pick<Run, "agentKind"> }) {
  const text = runKind(run) === "text";
  return (
    <Badge tone={text ? "agent" : "muted"} className="shrink-0 px-1.5 py-0 text-[10px]">
      {text ? "Text" : "Voice"}
    </Badge>
  );
}
