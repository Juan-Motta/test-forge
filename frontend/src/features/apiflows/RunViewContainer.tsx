"use client";

import { useState } from "react";
import { ApiError, errorMessage } from "@/lib/api";
import { localErrorMessage, useT } from "@/lib/i18n";
import { Alert, ApiFlowsIcon, Button, EmptyState, Spinner, useClipboard } from "@/ui";
import { stepCurl } from "./api";
import { flowHref, runHref } from "./ApiTable";
import { useFlowRun } from "./queries";
import { defaultStepIndex } from "./run-view";
import { RunView } from "./RunView";
import type { Api, Flow, FlowRun } from "./types";
import { useSecretReveal } from "./use-secret-reveal";

type RunViewContainerProps = { api: Pick<Api, "id" | "secrets">; flow: Flow; runId: string };

/** `?flow=<id>&run=<runId>`: loads the run, then shows it. */
export function RunViewContainer({ api, flow, runId }: RunViewContainerProps) {
  const t = useT();
  const run = useFlowRun(runId);
  if (run.isError && run.error instanceof ApiError && run.error.status === 404) {
    return <EmptyState icon={<ApiFlowsIcon size={22} />} title={t("flowRuns.notFound")} description={t("flowRuns.notFoundHint")} />;
  }
  if (run.isError) {
    return (
      <Alert title={t("flowRuns.loadFailed")}>
        <span className="block">{errorMessage(run.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => run.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  }
  if (run.isPending) return <Spinner label={t("flowRuns.loading")} />;
  return <StoredRun key={run.data.id} api={api} flow={flow} run={run.data} />;
}

/**
 * The run's state: the selected step (the first failed one to start), the eye over the API's
 * secrets (values fetched only on click, kept in this component only), and Copy cURL of what is shown.
 */
function StoredRun({ api, flow, run }: { api: Pick<Api, "id" | "secrets">; flow: Flow; run: FlowRun }) {
  const t = useT();
  const [selected, setSelected] = useState(() => defaultStepIndex(run.steps));
  const reveal = useSecretReveal(api.id);
  const [clip, copy] = useClipboard();
  const [copied, setCopied] = useState<number>();
  const [alert, setAlert] = useState<string>();
  const names = api.secrets.map((secret) => secret.name);
  const revealed = names.length > 0 && names.every((name) => name in reveal.shown);
  const hints = Object.fromEntries(api.secrets.map((secret) => [secret.name, secret.hint]));

  async function copyCurl() {
    const step = run.steps[selected];
    if (!step) return;
    setAlert(undefined);
    try {
      // What is shown: the values only while the eye shows them.
      const { curl } = await stepCurl(run.id, step.index, revealed);
      await copy(curl);
      setCopied(step.index);
    } catch (error) {
      setAlert(localErrorMessage(t, error));
    }
  }

  const status =
    clip === "copied" && copied !== undefined ? t("flowRuns.curlCopied", { n: copied + 1 }) : clip === "failed" ? t("ui.copyFailed") : undefined;

  return (
    <RunView
      run={run}
      flowName={flow.name}
      editHref={flowHref(api, flow.id)}
      againHref={runHref(api, flow.id, "new")}
      stepPaths={flow.steps.map((step) => step.path)}
      selected={selected}
      onSelect={(index) => {
        setSelected(index);
        setAlert(undefined);
      }}
      secrets={{ hints, shown: reveal.shown }}
      eye={
        names.length > 0
          ? {
              revealed,
              pending: names.some((name) => reveal.pending.has(name)),
              onToggle: () => void reveal.toggleAll(names),
              error: reveal.error,
            }
          : undefined
      }
      onCopyCurl={() => void copyCurl()}
      status={status}
      alert={alert}
    />
  );
}
