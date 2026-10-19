import type { ReactNode, Ref } from "react";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

type PageHeaderProps = {
  title: ReactNode;
  /** Links back to the parent pages of a subpage; top-level pages pass none. */
  breadcrumbs?: readonly Crumb[];
  description?: ReactNode;
  actions?: ReactNode;
  /** Lets a page move focus to its title (e.g. after the focused element was removed). */
  titleRef?: Ref<HTMLHeadingElement>;
};

export function PageHeader({ title, breadcrumbs, description, actions, titleRef }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} /> : null}
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
