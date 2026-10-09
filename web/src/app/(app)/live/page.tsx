import type { Metadata } from "next";
import { SectionPlaceholder } from "@/features/shell/SectionPlaceholder";
import { LiveIcon } from "@/ui";

export const metadata: Metadata = { title: "Live sessions" };

export default function Page() {
  return (
    <SectionPlaceholder
      title="Live sessions"
      description="Calls in progress between the evaluator and your agents."
      emptyTitle="No calls in progress"
      emptyDescription="Live sessions will appear here while a run is calling an agent, so you can listen in."
      icon={<LiveIcon size={22} />}
    />
  );
}
