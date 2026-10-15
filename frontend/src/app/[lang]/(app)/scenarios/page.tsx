import type { Metadata } from "next";
import { ScenariosContainer } from "@/features/scenarios/ScenariosContainer";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("nav.scenarios") };
}

export default function Page() {
  return <ScenariosContainer />;
}
