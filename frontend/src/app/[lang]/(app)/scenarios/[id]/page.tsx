import type { Metadata } from "next";
import { Suspense } from "react";
import { ScenarioEditorContainer } from "@/features/scenarios/ScenarioEditorContainer";
import { Spinner } from "@/ui";

export const metadata: Metadata = { title: "Scenario" };

// With Cache Components the id is runtime data: read it inside a Suspense boundary.
export default function Page({ params }: PageProps<"/[lang]/scenarios/[id]">) {
  return (
    <Suspense fallback={<Spinner label="Loading scenario" />}>
      {params.then(({ id }) => (
        <ScenarioEditorContainer key={id} scenarioId={id} />
      ))}
    </Suspense>
  );
}
