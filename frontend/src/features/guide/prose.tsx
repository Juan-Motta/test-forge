import Link from "next/link";
import { useId, type ReactNode } from "react";
import { AlertIcon, CheckIcon, cn } from "@/ui";

/** Building blocks for guide pages: headings, text, steps, callouts, tables and figures. */

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="group scroll-mt-24 pt-4 text-xl font-semibold tracking-[-0.01em] text-fg">
      {children}
      <a
        href={`#${id}`}
        aria-hidden="true"
        tabIndex={-1}
        className="ml-2 text-dim no-underline opacity-0 transition-opacity group-hover:opacity-100"
      >
        #
      </a>
    </h2>
  );
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-24 pt-2 text-base font-semibold text-fg">
      {children}
    </h3>
  );
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[15px] leading-7 text-body", className)}>{children}</p>;
}

/** A short lead paragraph, a step larger than body text. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="text-[17px] leading-8 text-body-strong">{children}</p>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-tag px-1.5 py-0.5 font-mono text-[0.85em] text-body-strong">{children}</code>;
}

/** The name of something on screen (a button, a field, a page), as the reader will see it. */
export function Ui({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-fg">{children}</strong>;
}

export function Bullets({ children }: { children: ReactNode }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-7 text-body marker:text-dim">{children}</ul>
  );
}

/** Numbered steps with round markers; each child is a `<Step>`. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex flex-col gap-4 [counter-reset:step]">{children}</ol>;
}

export function Step({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <li className="relative flex gap-3.5 [counter-increment:step]">
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-full border border-evaluator-line bg-evaluator/10 font-mono text-xs font-semibold text-evaluator-fg before:content-[counter(step)]"
      />
      <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
        <span className="text-[15px] font-semibold text-fg">{title}</span>
        {children ? <div className="flex flex-col gap-2 text-[15px] leading-7 text-body">{children}</div> : null}
      </div>
    </li>
  );
}

type CalloutTone = "tip" | "note" | "warning";

const CALLOUT: Record<CalloutTone, { label: string; className: string; icon: ReactNode }> = {
  tip: { label: "Tip", className: "border-success/40 bg-success/8 [&_[data-label]]:text-success-fg", icon: <CheckIcon size={16} /> },
  note: { label: "Note", className: "border-agent/40 bg-agent/8 [&_[data-label]]:text-agent-fg", icon: <InfoIcon /> },
  warning: {
    label: "Warning",
    className: "border-evaluator/45 bg-evaluator/8 [&_[data-label]]:text-evaluator-fg",
    icon: <AlertIcon size={16} />,
  },
};

/** Tip, note or warning box; the visible label also names it for assistive tech. */
export function Callout({ tone = "note", title, children }: { tone?: CalloutTone; title?: string; children: ReactNode }) {
  const style = CALLOUT[tone];
  const labelId = useId();
  return (
    <aside aria-labelledby={labelId} className={cn("flex gap-3 rounded-lg border px-4 py-3.5", style.className)}>
      <span data-label aria-hidden="true" className="mt-1 shrink-0">
        {style.icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1 text-[14px] leading-6 text-body">
        <p id={labelId} data-label className="font-semibold">
          {title ? `${style.label}: ${title}` : style.label}
        </p>
        <div className="flex flex-col gap-1.5">{children}</div>
      </div>
    </aside>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
    </svg>
  );
}

/** A captioned data table; it scrolls inside its own box on narrow screens, never the page. */
export function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="border-b border-line bg-raised px-3.5 py-2.5 text-left text-[13px] font-medium text-muted">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-field-border">
            {head.map((cell) => (
              <th key={cell} scope="col" className="px-3.5 py-2.5 text-xs font-medium whitespace-nowrap text-dim">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-line-soft align-top last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={cn("px-3.5 py-2.5 leading-6 text-body", cellIndex === 0 && "font-medium text-fg")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A diagram or mock-up with a visible caption that also names it. */
export function Figure({ caption, children, className }: { caption: string; children: ReactNode; className?: string }) {
  const captionId = useId();
  return (
    <figure aria-labelledby={captionId} className={cn("flex flex-col gap-3 rounded-xl border border-line bg-panel p-4 sm:p-5", className)}>
      {children}
      <figcaption id={captionId} className="text-[13px] leading-5 text-muted">
        {caption}
      </figcaption>
    </figure>
  );
}

/** A static picture of a screen: announced as one image, never focusable or clickable. */
export function Mockup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="img" aria-label={label} inert className="pointer-events-none select-none">
      {children}
    </div>
  );
}

/** A region with its own heading (the glossary, a module card). */
export function Region({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <H2 id={id}>{title}</H2>
      {children}
    </section>
  );
}

export function Definitions({ items }: { items: { term: string; definition: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      {items.map(({ term, definition }) => (
        <div key={term} className="contents">
          <dt className="pt-0.5 text-[15px] font-semibold text-fg">{term}</dt>
          <dd className="border-b border-line-soft pb-3 text-[15px] leading-7 text-body sm:border-b-0 sm:pb-0">{definition}</dd>
        </div>
      ))}
    </dl>
  );
}

/** An internal link to another guide page or an anchor. */
export function GuideLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="underline decoration-evaluator/40 underline-offset-4 hover:decoration-evaluator">
      {children}
    </Link>
  );
}
