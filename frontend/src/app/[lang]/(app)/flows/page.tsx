import type { Metadata } from "next";
import { FlowsContainer } from "@/features/apiflows/FlowsContainer";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("nav.flows") };
}

export default function Page() {
  return <FlowsContainer />;
}
