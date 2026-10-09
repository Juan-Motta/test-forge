import type { Metadata } from "next";
import { SectionPlaceholder } from "@/features/shell/SectionPlaceholder";
import { RunsIcon } from "@/ui";

export const metadata: Metadata = { title: "Runs & reports" };

export default function Page() {
  return (
    <SectionPlaceholder
      title="Runs & reports"
      description="Every evaluation run with its transcript, scores and findings."
      emptyTitle="No runs yet"
      emptyDescription="Runs and their reports will appear here after you run a scenario against an agent."
      icon={<RunsIcon size={22} />}
    />
  );
}
