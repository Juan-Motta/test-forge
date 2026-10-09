import type { ReactNode } from "react";
import { EmptyState } from "@/ui";
import { PageHeader } from "./PageHeader";

type SectionPlaceholderProps = {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: ReactNode;
  icon: ReactNode;
};

/** A section that exists in the navigation but has no data to show yet. */
export function SectionPlaceholder({ title, description, emptyTitle, emptyDescription, icon }: SectionPlaceholderProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} />
    </>
  );
}
