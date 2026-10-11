"use client";

import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { LiveRunPanel } from "./LiveRunPanel";

/** Container for `/runs/[id]/live`: one run in focus. */
export function LiveRunContainer({ runId }: { runId: string }) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/runs">Runs</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/runs/${encodeURIComponent(runId)}`}>Run</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Live</span>
      </nav>
      <PageHeader title="Live session" description="Watch and listen to the call as it happens." />
      <LiveRunPanel runId={runId} />
    </>
  );
}
