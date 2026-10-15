import type { Metadata } from "next";
import { Suspense } from "react";
import { RunsContainer } from "@/features/runs/RunsContainer";
import { Spinner } from "@/ui";

export const metadata: Metadata = { title: "Runs & reports" };

// The filters come from the URL (runtime data): read them inside a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={<Spinner label="Loading runs" />}>
      <RunsContainer />
    </Suspense>
  );
}
