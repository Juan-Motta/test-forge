import type { Translator } from "@/lib/i18n";
import { shortId } from "./format";
import type { Batch } from "./types";

/** A batch's label, or "Batch <short id>" when it has none. */
export function batchName(t: Translator, batch: Pick<Batch, "id" | "label">): string {
  return batch.label ?? t("runs.batch", { id: shortId(batch.id) });
}
