import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveContainer } from "@/features/live/LiveContainer";
import { T } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { Spinner } from "@/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("nav.live") };
}

// `?batchId=` is runtime data: read it inside a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={<Spinner label={<T k="live.loading" />} />}>
      <LiveContainer />
    </Suspense>
  );
}
