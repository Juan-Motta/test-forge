import type { Metadata } from "next";
import { Suspense } from "react";
import { ScenarioEditorContainer } from "@/features/scenarios/ScenarioEditorContainer";
import { T } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { Spinner } from "@/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("scenarios.one") };
}

// With Cache Components the id is runtime data: read it inside a Suspense boundary.
export default function Page({ params }: PageProps<"/[lang]/scenarios/[id]">) {
  return (
    <Suspense fallback={<Spinner label={<T k="scenarios.loadingOne" />} />}>
      {params.then(({ id }) => (
        <ScenarioEditorContainer key={id} scenarioId={id} />
      ))}
    </Suspense>
  );
}
