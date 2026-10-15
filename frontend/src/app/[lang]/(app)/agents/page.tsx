import type { Metadata } from "next";
import { AgentsWithScenarioCounts } from "@/features/scenarios/AgentsWithScenarioCounts";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("nav.agents") };
}

export default function Page() {
  return <AgentsWithScenarioCounts />;
}
