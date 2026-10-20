import type { Metadata } from "next";
import { ApisContainer } from "@/features/apiflows/ApisContainer";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("nav.apis") };
}

export default function Page() {
  return <ApisContainer />;
}
