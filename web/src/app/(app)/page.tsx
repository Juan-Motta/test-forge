import type { Metadata } from "next";
import { SectionPlaceholder } from "@/features/shell/SectionPlaceholder";
import { OverviewIcon } from "@/ui";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return (
    <SectionPlaceholder
      title="Overview"
      description="Results across all your agents at a glance."
      emptyTitle="Nothing to summarize yet"
      emptyDescription="Once runs finish, their scores, goal completion and latency trends will appear here."
      icon={<OverviewIcon size={22} />}
    />
  );
}
