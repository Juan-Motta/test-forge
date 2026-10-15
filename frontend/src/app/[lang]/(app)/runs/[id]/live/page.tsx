import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveRunContainer } from "@/features/live/LiveRunContainer";
import { T } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { Spinner } from "@/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("live.sessionTitle") };
}

// With Cache Components the id is runtime data: read it inside a Suspense boundary.
export default function Page({ params }: PageProps<"/[lang]/runs/[id]/live">) {
  return (
    <Suspense fallback={<Spinner label={<T k="runs.loadingOne" />} />}>
      {params.then(({ id }) => (
        <LiveRunContainer key={id} runId={id} />
      ))}
    </Suspense>
  );
}
