import type { Metadata } from "next";
import { ScenariosContainer } from "@/features/scenarios/ScenariosContainer";

export const metadata: Metadata = { title: "Scenarios" };

export default function Page() {
  return <ScenariosContainer />;
}
