import type { Metadata } from "next";
import { ConnectionsContainer } from "@/features/connections/ConnectionsContainer";

export const metadata: Metadata = { title: "Connections" };

export default function Page() {
  return <ConnectionsContainer />;
}
