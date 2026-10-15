import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveContainer } from "@/features/live/LiveContainer";
import { Spinner } from "@/ui";

export const metadata: Metadata = { title: "Live sessions" };

// `?batchId=` is runtime data: read it inside a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={<Spinner label="Loading live sessions" />}>
      <LiveContainer />
    </Suspense>
  );
}
