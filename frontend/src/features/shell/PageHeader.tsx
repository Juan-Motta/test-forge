import type { ReactNode, Ref } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Lets a page move focus to its title (e.g. after the focused element was removed). */
  titleRef?: Ref<HTMLHeadingElement>;
};

export function PageHeader({ title, description, actions, titleRef }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h1
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
          className="text-[28px] font-semibold tracking-[-0.02em] focus:outline-none"
        >
          {title}
        </h1>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}
