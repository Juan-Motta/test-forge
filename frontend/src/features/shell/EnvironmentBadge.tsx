import { T } from "@/lib/i18n";
import { ChevronDownIcon } from "@/ui";

/** The environment the console points at, drawn as the design's selector pill (no menu yet). */
export function EnvironmentBadge({ label }: { label: string }) {
  return (
    <p
      data-environment
      className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-field-border bg-panel px-3 text-[13px]"
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 rounded-full bg-success" />
        <span>
          <T k="shell.environment" vars={{ label }} />
        </span>
      </span>
      <ChevronDownIcon size={14} strokeWidth={2} className="text-dim" />
    </p>
  );
}
