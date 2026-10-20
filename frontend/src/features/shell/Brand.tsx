import { T } from "@/lib/i18n";

/** The TestForge mark (code brackets, blue, with an amber slash on a black block) and wordmark.
 * The block stays black in both themes; a hairline keeps it visible on the dark sidebar. */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <span
        aria-hidden="true"
        className="flex size-[30px] shrink-0 items-center justify-center rounded-lg border border-line-strong bg-[#111318]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M7 7 2 12l5 5M17 7l5 5-5 5" stroke="#6cb6f5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.5 5 10.5 19" stroke="#f0b04a" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-[17px] font-bold tracking-[-0.01em]">TestForge</span>
        <span className="text-xs text-dim">
          <T k="shell.tagline" />
        </span>
      </div>
    </div>
  );
}
