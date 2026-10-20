import { Badge, type BadgeTone } from "@/ui";
import type { HttpMethod } from "./types";

/** GET blue, POST green, PATCH amber, DELETE red; PUT stays neutral. */
const TONES: Record<HttpMethod, BadgeTone> = {
  GET: "agent",
  POST: "success",
  PUT: "neutral",
  PATCH: "evaluator",
  DELETE: "danger",
};

export function MethodChip({ method }: { method: HttpMethod }) {
  return (
    <Badge tone={TONES[method] ?? "neutral"} mono className="text-[10px] font-semibold">
      {method}
    </Badge>
  );
}
