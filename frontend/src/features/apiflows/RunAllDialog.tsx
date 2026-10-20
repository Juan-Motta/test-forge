"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { Badge, Button, Dialog, Spinner, cn, focusRing, type BadgeTone } from "@/ui";
import { runFlow } from "./api";
import { runHref } from "./links";
import { storedRun, useApiFlows } from "./queries";
import { runAllOutcome, type RunAllOutcome } from "./run-view";
import type { Api, Flow } from "./types";

type Progress = RunAllOutcome | { kind: "waiting" | "running" };

const TONE: Record<RunAllOutcome["kind"], BadgeTone> = {
  passed: "success",
  failed: "danger",
  needsInputs: "evaluator",
  aiUnavailable: "evaluator",
  error: "danger",
};

/**
 * Run all: asks first ("Run N flows"), then runs every flow of the API one after another with no
 * inputs, listing how each ended with a link to its run. Leaving stops before the next flow.
 */
export function RunAllDialog({ api, onClose }: { api: Pick<Api, "id" | "name">; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const flows = useApiFlows(api.id);
  const [progress, setProgress] = useState<Record<string, Progress>>();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const list = flows.data ?? [];
  const started = progress !== undefined;
  const busy = started && Object.values(progress).some((item) => item.kind === "waiting" || item.kind === "running");

  async function runAll(targets: Flow[]) {
    setProgress(Object.fromEntries(targets.map((flow) => [flow.id, { kind: "waiting" as const }])));
    for (const flow of targets) {
      if (!live.current) return;
      setProgress((current) => ({ ...current, [flow.id]: { kind: "running" } }));
      let outcome: RunAllOutcome;
      try {
        const run = await runFlow(flow.id, {});
        void storedRun(queryClient, run);
        outcome = runAllOutcome({ run });
      } catch (error) {
        outcome = runAllOutcome({ error });
      }
      if (!live.current) return;
      setProgress((current) => ({ ...current, [flow.id]: outcome }));
    }
  }

  const title = t.plural("runAll.title", list.length);
  const passed = started ? Object.values(progress).filter((item) => item.kind === "passed").length : 0;

  return (
    <Dialog
      open
      title={started ? t("runAll.results") : flows.isPending ? t("runAll.button") : title}
      description={started ? undefined : t("runAll.description")}
      onClose={onClose}
      actions={
        started ? (
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("runAll.close")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button disabled={list.length === 0} onClick={() => void runAll(list)}>
              {title}
            </Button>
          </>
        )
      }
    >
      {flows.isPending ? <Spinner label={t("runAll.loadingFlows")} /> : null}
      {started ? (
        <div className="flex flex-col gap-3">
          <ul aria-label={t("runAll.results")} className="flex flex-col gap-1">
            {list
              .filter((flow) => flow.id in progress)
              .map((flow) => (
                <ResultRow key={flow.id} api={api} flow={flow} progress={progress[flow.id]} onOpen={onClose} />
              ))}
          </ul>
          <p role="status" className="text-xs text-muted">
            {busy ? "" : t("runAll.done", { passed, total: Object.keys(progress).length })}
          </p>
        </div>
      ) : null}
    </Dialog>
  );
}

function ResultRow({ api, flow, progress, onOpen }: { api: Pick<Api, "id">; flow: Flow; progress: Progress; onOpen: () => void }) {
  const t = useT();
  let state;
  if (progress.kind === "waiting") state = <span className="text-xs text-dim">{t("runAll.waiting")}</span>;
  else if (progress.kind === "running") state = <Spinner size={14} label={t("runAll.running")} />;
  else {
    const label =
      progress.kind === "passed" || progress.kind === "failed" ? t(`flowRuns.status.${progress.kind}`) : t(`runAll.${progress.kind}`);
    state = (
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge tone={TONE[progress.kind]}>{label}</Badge>
        {"message" in progress ? <span className="text-xs break-words text-muted">{progress.message}</span> : null}
      </span>
    );
  }
  const run = "run" in progress ? progress.run : undefined;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2 last:border-b-0">
      {run ? (
        <Link
          href={runHref(api, flow.id, run.id)}
          onClick={onOpen}
          className={cn("rounded text-sm font-medium text-evaluator-fg hover:underline", focusRing)}
        >
          {flow.name}
        </Link>
      ) : (
        <span className="text-sm font-medium">{flow.name}</span>
      )}
      {state}
    </li>
  );
}
