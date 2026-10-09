import type { ReactNode } from "react";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-line-strong bg-panel px-6 py-14 text-center">
      {icon ? (
        <span className="flex size-12 items-center justify-center rounded-xl bg-raised text-muted">{icon}</span>
      ) : null}
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm leading-relaxed text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
