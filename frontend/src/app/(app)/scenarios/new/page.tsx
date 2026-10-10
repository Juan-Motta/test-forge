import type { Metadata } from "next";
import { NewScenario } from "@/features/scenarios/NewScenario";

export const metadata: Metadata = { title: "New scenario" };

export default function Page() {
  return <NewScenario />;
}
