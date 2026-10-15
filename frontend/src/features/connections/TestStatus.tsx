import { useFormat, useT } from "@/lib/i18n";
import { AlertIcon, Badge, CheckIcon } from "@/ui";
import type { LastTest } from "./types";

/** Last test outcome: a labelled chip (never color alone), when it ran, and the server's detail. */
export function TestStatus({ lastTest }: { lastTest: LastTest | null }) {
  const t = useT();
  const { absoluteTime, relativeTime } = useFormat();
  if (!lastTest) return <Badge>{t("check.notTested")}</Badge>;
  const { ok, at, detail } = lastTest;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ok ? "success" : "danger"}>
          {ok ? <CheckIcon size={12} /> : <AlertIcon size={12} />}
          {ok ? t("connections.passed") : t("runs.status.failed")}
        </Badge>
        <time dateTime={at} title={absoluteTime(at)} className="text-xs text-dim">
          {relativeTime(at)}
        </time>
      </div>
      {detail ? (
        <p title={detail} className="max-w-64 truncate text-xs text-muted">
          {detail}
        </p>
      ) : null}
    </div>
  );
}
