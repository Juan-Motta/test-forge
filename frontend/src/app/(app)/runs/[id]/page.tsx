import type { Metadata } from "next";
import { Suspense } from "react";
import { RunDetailContainer } from "@/features/runs/RunDetailContainer";
import { Spinner } from "@/ui";

export const metadata: Metadata = { title: "Run report" };

// With Cache Components the id is runtime data: read it inside a Suspense boundary.
export default function Page({ params }: PageProps<"/runs/[id]">) {
  return (
    <Suspense fallback={<Spinner label="Loading run" />}>
      {params.then(({ id }) => (
        <RunDetailContainer key={id} runId={id} />
      ))}
    </Suspense>
  );
}
