import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveRunContainer } from "@/features/live/LiveRunContainer";
import { Spinner } from "@/ui";

export const metadata: Metadata = { title: "Live session" };

// With Cache Components the id is runtime data: read it inside a Suspense boundary.
export default function Page({ params }: PageProps<"/runs/[id]/live">) {
  return (
    <Suspense fallback={<Spinner label="Loading run" />}>
      {params.then(({ id }) => (
        <LiveRunContainer key={id} runId={id} />
      ))}
    </Suspense>
  );
}
