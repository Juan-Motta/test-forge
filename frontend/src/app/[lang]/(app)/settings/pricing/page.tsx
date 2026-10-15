import type { Metadata } from "next";
import { ModelPricesContainer } from "@/features/pricing/ModelPricesContainer";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("prices.title") };
}

export default function Page() {
  return <ModelPricesContainer />;
}
