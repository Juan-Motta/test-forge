import type { Metadata } from "next";
import { OverviewContainer } from "@/features/overview/OverviewContainer";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return <OverviewContainer />;
}
