import type { Metadata } from "next";
import { ApiKeysContainer } from "@/features/api-keys/ApiKeysContainer";

export const metadata: Metadata = { title: "API keys" };

export default function Page() {
  return <ApiKeysContainer />;
}
