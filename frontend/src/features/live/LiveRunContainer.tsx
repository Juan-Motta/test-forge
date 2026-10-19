"use client";

import { shortRunId } from "@/features/runs/RunHeader";
import { PageHeader } from "@/features/shell/PageHeader";
import { useT } from "@/lib/i18n";
import { LiveRunPanel } from "./LiveRunPanel";

/** Container for `/runs/[id]/live`: one run in focus. */
export function LiveRunContainer({ runId }: { runId: string }) {
  const t = useT();
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t("nav.runs"), href: "/runs" },
          { label: t("live.crumbRun", { id: shortRunId(runId) }), href: `/runs/${encodeURIComponent(runId)}` },
        ]}
        title={t("live.sessionTitle")}
        description={t("live.sessionDescription")}
      />
      <LiveRunPanel runId={runId} />
    </>
  );
}
