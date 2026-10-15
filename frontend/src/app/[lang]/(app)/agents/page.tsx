import type { Metadata } from "next";
import { AgentsWithScenarioCounts } from "@/features/scenarios/AgentsWithScenarioCounts";

export const metadata: Metadata = { title: "Agents" };

export default function Page() {
  return <AgentsWithScenarioCounts />;
}
