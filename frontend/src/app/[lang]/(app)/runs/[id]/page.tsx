import type { Metadata } from "next";
import { Suspense } from "react";
import { RunDetailContainer } from "@/features/runs/RunDetailContainer";
import { T } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { Spinner } from "@/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("meta.runReport") };
}

// With Cache Components the id is runtime data: read it inside a Suspense boundary.
export default function Page({ params }: PageProps<"/[lang]/runs/[id]">) {
  return (
    <Suspense fallback={<Spinner label={<T k="runs.loadingOne" />} />}>
      {params.then(({ id }) => (
        <RunDetailContainer key={id} runId={id} />
      ))}
    </Suspense>
  );
}
