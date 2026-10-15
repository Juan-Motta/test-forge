import type { ReactNode, Ref } from "react";

type PageHeaderProps = {
  title: ReactNode;
  /** Small dim line above the title (breadcrumb, run id, section). */
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Lets a page move focus to its title (e.g. after the focused element was removed). */
  titleRef?: Ref<HTMLHeadingElement>;
};

export function PageHeader({ title, eyebrow, description, actions, titleRef }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow ? (
          <div data-eyebrow className="text-[13px] text-dim">
            {eyebrow}
          </div>
        ) : null}
        <h1
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
          className="text-[28px] font-semibold tracking-[-0.02em] focus:outline-none"
        >
          {title}
        </h1>
        {description ? <div className="text-sm text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}
