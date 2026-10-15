import type { Metadata } from "next";
import { Suspense } from "react";
import { RunsContainer } from "@/features/runs/RunsContainer";
import { T } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { Spinner } from "@/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("nav.runs") };
}

// The filters come from the URL (runtime data): read them inside a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={<Spinner label={<T k="runs.loading" />} />}>
      <RunsContainer />
    </Suspense>
  );
}
