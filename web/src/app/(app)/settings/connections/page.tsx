import type { Metadata } from "next";
import { SectionPlaceholder } from "@/features/shell/SectionPlaceholder";
import { ConnectionsIcon } from "@/ui";

export const metadata: Metadata = { title: "Connections" };

export default function Page() {
  return (
    <SectionPlaceholder
      title="Connections"
      description="Credentials for the providers runs use: OpenAI, Azure OpenAI, Azure AI Speech and Langfuse."
      emptyTitle="No connections yet"
      emptyDescription="Provider connections will appear here. Each one stores its secret encrypted, and only a hint is ever shown."
      icon={<ConnectionsIcon size={22} />}
    />
  );
}
