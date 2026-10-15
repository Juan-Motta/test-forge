import { T } from "@/lib/i18n";

/** Two-circle mark (blue agent, amber evaluator) and the Duet wordmark. */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <svg width="30" height="22" viewBox="0 0 30 22" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="9" stroke="var(--ve-agent)" strokeWidth="2" />
        <circle cx="19" cy="11" r="9" stroke="var(--ve-evaluator)" strokeWidth="2" />
      </svg>
      <div className="flex flex-col leading-tight">
        <span className="text-[17px] font-bold tracking-[-0.01em]">Duet</span>
        <span className="text-xs text-dim">
          <T k="shell.tagline" />
        </span>
      </div>
    </div>
  );
}
