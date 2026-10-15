import type { Metadata } from "next";
import { ModelPricesContainer } from "@/features/pricing/ModelPricesContainer";

export const metadata: Metadata = { title: "Model prices" };

export default function Page() {
  return <ModelPricesContainer />;
}
