"use client";

import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { useT } from "@/lib/i18n";
import { LiveRunPanel } from "./LiveRunPanel";

/** Container for `/runs/[id]/live`: one run in focus. */
export function LiveRunContainer({ runId }: { runId: string }) {
  const t = useT();
  return (
    <>
      <nav aria-label={t("common.breadcrumb")} className="text-sm text-muted">
        <Link href="/runs">{t("runs.breadcrumb")}</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/runs/${encodeURIComponent(runId)}`}>{t("live.crumbRun")}</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{t("runs.live")}</span>
      </nav>
      <PageHeader title={t("live.sessionTitle")} description={t("live.sessionDescription")} />
      <LiveRunPanel runId={runId} />
    </>
  );
}
