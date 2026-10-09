import type { Metadata } from "next";
import { SectionPlaceholder } from "@/features/shell/SectionPlaceholder";
import { ScenariosIcon } from "@/ui";

export const metadata: Metadata = { title: "Scenarios" };

export default function Page() {
  return (
    <SectionPlaceholder
      title="Scenarios"
      description="Scripted conversations the evaluator plays against an agent."
      emptyTitle="No scenarios yet"
      emptyDescription="Scenarios will appear here: each one describes a caller persona, a goal and how to judge the call."
      icon={<ScenariosIcon size={22} />}
    />
  );
}
