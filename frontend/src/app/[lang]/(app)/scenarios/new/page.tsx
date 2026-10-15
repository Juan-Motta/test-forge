import type { Metadata } from "next";
import { NewScenario } from "@/features/scenarios/NewScenario";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("scenarios.new") };
}

export default function Page() {
  return <NewScenario />;
}
