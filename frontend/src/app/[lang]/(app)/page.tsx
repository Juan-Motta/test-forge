import type { Metadata } from "next";
import { OverviewContainer } from "@/features/overview/OverviewContainer";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("nav.overview") };
}

export default function Page() {
  return <OverviewContainer />;
}
