import type { Metadata } from "next";
import { SectionPlaceholder } from "@/features/shell/SectionPlaceholder";
import { AgentsIcon } from "@/ui";

export const metadata: Metadata = { title: "Agents" };

export default function Page() {
  return (
    <SectionPlaceholder
      title="Agents"
      description="The voice agents under test and how to reach them."
      emptyTitle="No agents yet"
      emptyDescription="Agents will appear here with their connection details, protocol and evaluation settings."
      icon={<AgentsIcon size={22} />}
    />
  );
}
