import type { Metadata } from "next";
import { ConnectionsContainer } from "@/features/connections/ConnectionsContainer";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("nav.connections") };
}

export default function Page() {
  return <ConnectionsContainer />;
}
