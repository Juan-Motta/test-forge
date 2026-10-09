import { AlertIcon, Badge, CheckIcon } from "@/ui";
import { absoluteTime, relativeTime } from "./format";
import type { LastTest } from "./types";

/** Last test outcome: a labelled chip (never color alone), when it ran, and the server's detail. */
export function TestStatus({ lastTest }: { lastTest: LastTest | null }) {
  if (!lastTest) return <Badge>Not tested</Badge>;
  const { ok, at, detail } = lastTest;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ok ? "success" : "danger"}>
          {ok ? <CheckIcon size={12} /> : <AlertIcon size={12} />}
          {ok ? "Passed" : "Failed"}
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
