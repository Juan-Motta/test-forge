import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type CardProps = HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" };

/** Panel surface: the canvas' rounded, bordered container. */
export function Card({ as: Tag = "section", className, ...props }: CardProps) {
  return (
    <Tag
      className={cn("flex flex-col gap-4 rounded-xl border border-line bg-panel p-5", className)}
      {...props}
    />
  );
}

export function CardHeader({ title, actions, id }: { title: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {actions}
    </div>
  );
}
