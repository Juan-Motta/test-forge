import type { Metadata } from "next";
import { SectionPlaceholder } from "@/features/shell/SectionPlaceholder";
import { SettingsIcon } from "@/ui";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <SectionPlaceholder
      title="Settings"
      description="Workspace configuration."
      emptyTitle="Nothing to configure here yet"
      emptyDescription="Workspace settings will appear here. Provider credentials live under Connections."
      icon={<SettingsIcon size={22} />}
    />
  );
}
