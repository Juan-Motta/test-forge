import type { Metadata } from "next";
import { AgentsContainer } from "@/features/agents/AgentsContainer";

export const metadata: Metadata = { title: "Agents" };

export default function Page() {
  return <AgentsContainer />;
}
